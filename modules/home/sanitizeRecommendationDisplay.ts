import { normalizeRecommendationText } from "@/_legacy_web/app/api/_utils/recommendationText";
import type { AppLocale } from "@/modules/i18n/localeStore";

export function sanitizeRecommendationDisplay(text: string | undefined | null, locale: AppLocale): string {
  return normalizeRecommendationText(text ?? "", locale);
}
