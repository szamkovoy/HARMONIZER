/**
 * Мост синхронизации уровня профиля между сайтом (оплата в Личном кабинете)
 * и приложением. Монтируется один раз в корневом layout под AuthProvider.
 *
 * Обязанности:
 *   1. Supabase Realtime подписка на собственную строку `users` — UPDATE
 *      (смена membership_tier на сайте) мгновенно триггерит refreshProfile().
 *   2. Тихий refetch при возвращении приложения в foreground: сравниваем
 *      membership-поля и дёргаем refreshProfile() только при изменении
 *      (без profileLoading-мигания на каждом переключении приложений).
 *   3. Модалка «Спасибо! Уровень профиля изменён…» при повышении уровня
 *      (сравнение с последним известным уровнем, переживает перезапуск).
 *   4. Одноразовая модалка «Демонстрационный период завершён» после
 *      истечения trial (кнопки «Закрыть» / «Личный кабинет»).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Modal, StyleSheet, View } from "react-native";

import { useAccountLinksEnabled } from "@/modules/account/core/accountLinksConfig";
import { openAccountCabinet } from "@/modules/account/core/openAccountCabinet";
import {
  clearCabinetVisit,
  readFreshCabinetVisit,
} from "@/modules/account/core/openAccountCabinet";
import { readAccountFlag, writeAccountFlag } from "@/modules/account/core/accountFlagsStore";
import { fetchLastPurchase } from "@/modules/account/core/purchasesClient";
import { baseTierFromRow, hasActiveTrial } from "@/modules/access/core/paidAccess";
import { TIER_ORDER, type ProductTier } from "@/modules/access/core/tiers";
import { useAuth } from "@/modules/auth";
import { useTranslate } from "@/modules/i18n";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { requireSupabase } from "@/services/supabase";
import { logRuntimeEvent, logRuntimeTap } from "@/services/runtimeDiagnostics";

type NoticeState =
  | { kind: "none" }
  | { kind: "trial_ended" }
  | { kind: "tier_changed"; fromTier: ProductTier; toTier: ProductTier }
  | { kind: "webinar_paid" }
  | { kind: "book_paid" };

function membershipFingerprint(row: {
  membership_tier?: string | null;
  membership_expires_at?: string | null;
  trial_expires_at?: string | null;
} | null): string {
  if (!row) return "";
  return [row.membership_tier ?? "", row.membership_expires_at ?? "", row.trial_expires_at ?? ""].join("|");
}

export function MembershipEventsBridge() {
  const { authUser, profile, refreshProfile } = useAuth();
  const [notice, setNotice] = useState<NoticeState>({ kind: "none" });
  const noticeVisibleRef = useRef(false);
  noticeVisibleRef.current = notice.kind !== "none";

  const userId = authUser?.id ?? null;
  const profileRef = useRef(profile);
  profileRef.current = profile;

  // ── 1. Realtime: своя строка users ─────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    const supabase = requireSupabase();
    const channel = supabase
      .channel(`users-membership-${userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "users", filter: `id=eq.${userId}` },
        () => {
          logRuntimeEvent("membership:realtime_update", { userId });
          void refreshProfile().catch(() => undefined);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refreshProfile, userId]);

  // ── 2. Foreground: тихий refetch membership-полей ──────────────────────────
  useEffect(() => {
    if (!userId) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void (async () => {
        try {
          const { data, error } = await requireSupabase()
            .from("users")
            .select("membership_tier,membership_expires_at,trial_expires_at")
            .eq("id", userId)
            .maybeSingle();
          if (error || !data) return;
          const current = profileRef.current;
          if (membershipFingerprint(data) !== membershipFingerprint(current)) {
            logRuntimeEvent("membership:foreground_changed", { userId });
            await refreshProfile();
          }
        } catch {
          /* транзиентная сеть — Realtime/следующий foreground допроверит */
        }
      })();
    });
    return () => sub.remove();
  }, [refreshProfile, userId]);

  // ── 2bc. Foreground: благодарность за разовую покупку (вебинар/книга) ────────
  // При возврате из Личного кабинета (любой ctx — профиль, карточка вебинара,
  // апселл) проверяем последнюю разовую покупку через GET /api/account/purchases/last.
  // Если это вебинар или книга, оплаченные после момента визита в кабинет, и мы
  // ещё не благодарили за этот контракт — показываем модалку. Работает для любого
  // входа в кабинет, а не только ctx=webinar:<id> (раньше вебинар детектился только
  // при входе из карточки вебинара — оплата из профиля не давала модалки). Вебхук
  // payment.success может прийти чуть позже — один ретрай через 10с. Visit чистим
  // только после показа (до этого храним для ретрая).
  useEffect(() => {
    if (!userId) return;
    const uid = userId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function checkPurchase(): Promise<"shown" | "pending" | "none"> {
      const visit = await readFreshCabinetVisit(uid);
      if (!visit) return "none";
      const purchase = await fetchLastPurchase();
      if (cancelled) return "none";
      const recentVisit = Date.now() - visit.ts < 90_000;
      const kind = purchase?.kind;
      if (!purchase || (kind !== "book" && kind !== "webinar")) {
        return recentVisit ? "pending" : "none";
      }
      const paidAt = new Date(purchase.createdAt).getTime();
      if (!Number.isFinite(paidAt) || paidAt <= visit.ts) return recentVisit ? "pending" : "none";
      const shownFlag = `purchaseThanksShown.${uid}.${purchase.contractId}`;
      if ((await readAccountFlag(shownFlag)) === visit.ts.toString()) return "none";
      await writeAccountFlag(shownFlag, visit.ts.toString());
      await clearCabinetVisit(uid);
      if (cancelled || noticeVisibleRef.current) return "none";
      logRuntimeEvent(
        kind === "webinar" ? "membership:webinar_paid_notice" : "membership:book_paid_notice",
        { userId: uid, contractId: purchase.contractId },
      );
      setNotice({ kind: kind === "webinar" ? "webinar_paid" : "book_paid" });
      return "shown";
    }

    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void checkPurchase().then((status) => {
        if (status === "pending" && !cancelled) {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void checkPurchase(), 10000);
        }
      });
    });
    return () => {
      cancelled = true;
      sub.remove();
      if (timer) clearTimeout(timer);
    };
  }, [userId]);
  useEffect(() => {
    if (!userId || !profile) return;
    let cancelled = false;
    void (async () => {
      const baseTier = baseTierFromRow(profile);
      const trialActive = hasActiveTrial(profile);

      // Повышение уровня (сравнение с последним сохранённым значением).
      const storedTier = (await readAccountFlag(`lastTier.${userId}`)) as ProductTier | null;
      if (cancelled) return;
      if (storedTier && storedTier in TIER_ORDER) {
        if (TIER_ORDER[baseTier] > TIER_ORDER[storedTier]) {
          await writeAccountFlag(`lastTier.${userId}`, baseTier);
          if (!cancelled && !noticeVisibleRef.current) {
            logRuntimeEvent("membership:tier_upgraded", { from: storedTier, to: baseTier });
            setNotice({ kind: "tier_changed", fromTier: storedTier, toTier: baseTier });
          }
          return;
        }
        if (baseTier !== storedTier) {
          await writeAccountFlag(`lastTier.${userId}`, baseTier);
        }
      } else {
        await writeAccountFlag(`lastTier.${userId}`, baseTier);
      }

      // Истечение демо-периода: trial был и закончился, платного уровня нет.
      const trialExpiresAt = profile.trial_expires_at ? new Date(profile.trial_expires_at).getTime() : null;
      const trialExpired = trialExpiresAt !== null && trialExpiresAt <= Date.now();
      if (baseTier === "free" && !trialActive && trialExpired) {
        const shown = await readAccountFlag(`trialEndedShown.${userId}`);
        if (cancelled || shown === "1" || noticeVisibleRef.current) return;
        await writeAccountFlag(`trialEndedShown.${userId}`, "1");
        if (!cancelled) {
          logRuntimeEvent("membership:trial_ended_notice", { userId });
          setNotice({ kind: "trial_ended" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile, userId]);

  if (notice.kind === "none") return null;
  return <MembershipNoticeModal notice={notice} onClose={() => setNotice({ kind: "none" })} />;
}

function MembershipNoticeModal({
  notice,
  onClose,
}: {
  notice: Exclude<NoticeState, { kind: "none" }>;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslate();
  const linksEnabled = useAccountLinksEnabled();
  const [opening, setOpening] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const onOpenCabinet = useCallback(async () => {
    logRuntimeTap("membership_notice_open_cabinet", { kind: notice.kind });
    setErrorText(null);
    setOpening(true);
    try {
      await openAccountCabinet();
      onClose();
    } catch (error) {
      logRuntimeEvent(
        "membership_notice_cabinet_error",
        { message: error instanceof Error ? error.message : String(error) },
        "warn",
      );
      setErrorText(t("gate.cabinetError"));
    } finally {
      setOpening(false);
    }
  }, [notice.kind, onClose, t]);

  const isTrialEnded = notice.kind === "trial_ended";
  const isWebinarPaid = notice.kind === "webinar_paid";
  const isBookPaid = notice.kind === "book_paid";
  const title = isTrialEnded
    ? t("gate.trialEnded.title")
    : isWebinarPaid
      ? t("gate.webinarPaid.title")
      : isBookPaid
        ? t("gate.bookPaid.title")
        : t("gate.tierChanged.title");
  const body = isTrialEnded
    ? t("gate.trialEnded.body")
    : isWebinarPaid
      ? t("gate.webinarPaid.body")
      : isBookPaid
        ? t("gate.bookPaid.body")
        : t("gate.tierChanged.body", {
            from: t(`tier.${notice.fromTier}`),
            to: t(`tier.${notice.toTier}`),
          });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: theme.colors.modalBackdrop }]}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.surfaceBorder,
            },
          ]}
        >
          <AppText variant="sectionTitle">{title}</AppText>
          <AppText variant="dialogBody" tone="muted">
            {body}
          </AppText>
          {errorText ? (
            <AppText variant="technicalCaption" style={{ color: theme.colors.danger }}>
              {errorText}
            </AppText>
          ) : null}
          <View style={styles.actions}>
            <AppButton
              label={isTrialEnded ? t("gate.close") : t("gate.tierChanged.ok")}
              variant={isTrialEnded ? "secondary" : "primary"}
              onPress={onClose}
              style={styles.action}
            />
            {isTrialEnded && linksEnabled ? (
              <AppButton
                label={opening ? "…" : t("gate.openCabinet")}
                onPress={() => void onOpenCabinet()}
                disabled={opening}
                style={styles.action}
              />
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    padding: 18,
    gap: 14,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  action: {
    flex: 1,
  },
});
