"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";

import { adminFetch } from "../../_lib/adminApi";
import { sanitizeEmailRichHtml } from "../../../api/_utils/emailRichHtml";
import {
  createEmptyBlock,
  enrichImageBlockDimensions,
  FONT_FAMILY_OPTIONS,
  loadImageNaturalSize,
  newBlockId,
  sanitizeEmailBlocks,
  type BlockAlign,
  type BlockFontFamily,
  type BlockFontSize,
  type EmailBlock,
} from "../_lib/blocks";

const ADD_TYPES: { type: EmailBlock["type"]; label: string }[] = [
  { type: "heading", label: "Заголовок" },
  { type: "text", label: "Текст" },
  { type: "image", label: "Изображение" },
  { type: "button", label: "Кнопка" },
];

type Props = {
  localeLabel: string;
  subject: string;
  blocks: EmailBlock[];
  onSave: (next: { subject: string; blocks: EmailBlock[] }) => Promise<void>;
  onClose: () => void;
};

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500";

export function EmailBlockEditor({ localeLabel, subject, blocks, onSave, onClose }: Props) {
  const [localSubject, setLocalSubject] = useState(subject);
  const [localBlocks, setLocalBlocks] = useState<EmailBlock[]>(() =>
    blocks.length ? structuredClone(blocks) : [createEmptyBlock("text")],
  );
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const localSubjectRef = useRef(localSubject);
  const localBlocksRef = useRef(localBlocks);
  localSubjectRef.current = localSubject;
  localBlocksRef.current = localBlocks;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && editIndex === null) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editIndex, onClose]);

  const updateBlock = useCallback((index: number, patch: Partial<EmailBlock>) => {
    setLocalBlocks((prev) =>
      prev.map((b, i) => (i === index ? ({ ...b, ...patch } as EmailBlock) : b)),
    );
  }, []);

  function insertAt(index: number, type: EmailBlock["type"]) {
    setLocalBlocks((prev) => {
      const next = [...prev];
      next.splice(index, 0, createEmptyBlock(type));
      return next;
    });
  }

  function duplicate(index: number) {
    setLocalBlocks((prev) => {
      const copy = { ...structuredClone(prev[index]), id: newBlockId() } as EmailBlock;
      const next = [...prev];
      next.splice(index + 1, 0, copy);
      return next;
    });
  }

  function remove(index: number) {
    setLocalBlocks((prev) => prev.filter((_, i) => i !== index));
    if (editIndex === index) setEditIndex(null);
  }

  function move(index: number, dir: -1 | 1) {
    setLocalBlocks((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
    if (editIndex === index) setEditIndex(index + dir);
  }

  async function handleSave(closeAfter: boolean) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      // Flush open contentEditable before save (onBlur may not have fired yet).
      if (typeof document !== "undefined") {
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
      }
      // Let React commit onBlur → onChange into refs.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      const blocks = sanitizeEmailBlocks(
        await enrichImageBlockDimensions(localBlocksRef.current),
      );
      localBlocksRef.current = blocks;
      setLocalBlocks(blocks);
      await onSave({
        subject: localSubjectRef.current.trim(),
        blocks,
      });
      if (closeAfter) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  const editing = editIndex != null ? localBlocks[editIndex] : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-100 text-zinc-900">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-3">
        <div>
          <div className="text-sm font-semibold">Редактор письма · {localeLabel}</div>
          <div className="text-xs text-zinc-500">Блоки · тема · сохранение только этого языка</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleSave(false)}
            disabled={saving}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
          <button
            type="button"
            onClick={() => void handleSave(true)}
            disabled={saving}
            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Сохранение…" : "Сохранить и выйти"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            Закрыть
          </button>
        </div>
      </header>

      {error ? (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 py-6">
        <label className="mb-4 block text-xs font-medium text-zinc-500">
          Тема письма ({localeLabel})
          <input
            className={`${inputCls} mt-1`}
            value={localSubject}
            onChange={(e) => setLocalSubject(e.target.value)}
            placeholder="Тема"
          />
        </label>

        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <InsertBar onInsert={(type) => insertAt(0, type)} />
          {localBlocks.map((block, index) => (
            <div key={block.id}>
              <div className="group relative my-2 rounded-lg border border-transparent hover:border-zinc-200 hover:bg-zinc-50">
                <div className="absolute right-1 top-1 z-10 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <IconBtn title="Вверх" onClick={() => move(index, -1)}>
                    <ArrowUp size={14} />
                  </IconBtn>
                  <IconBtn title="Вниз" onClick={() => move(index, 1)}>
                    <ArrowDown size={14} />
                  </IconBtn>
                  <IconBtn title="Копировать" onClick={() => duplicate(index)}>
                    <Copy size={14} />
                  </IconBtn>
                  <IconBtn title="Настройки" onClick={() => setEditIndex(index)}>
                    <Settings size={14} />
                  </IconBtn>
                  <IconBtn title="Удалить" onClick={() => remove(index)}>
                    <Trash2 size={14} />
                  </IconBtn>
                </div>
                <BlockPreview block={block} onOpen={() => setEditIndex(index)} />
              </div>
              <InsertBar onInsert={(type) => insertAt(index + 1, type)} />
            </div>
          ))}
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-zinc-200 bg-white px-4 py-3">
        {ADD_TYPES.map(({ type, label }) => (
          <button
            key={type}
            type="button"
            onClick={() => insertAt(localBlocks.length, type)}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
          >
            <Plus size={12} /> {label}
          </button>
        ))}
      </footer>

      {editing && editIndex != null ? (
        <BlockSettingsModal
          block={editing}
          onChange={(patch) => updateBlock(editIndex, patch)}
          onClose={() => setEditIndex(null)}
        />
      ) : null}
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded bg-white p-1 text-zinc-600 shadow border border-zinc-200 hover:text-zinc-900"
    >
      {children}
    </button>
  );
}

function InsertBar({ onInsert }: { onInsert: (type: EmailBlock["type"]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex justify-center py-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800 text-white hover:bg-zinc-700"
        title="Вставить блок"
      >
        <Plus size={14} />
      </button>
      {open ? (
        <div className="absolute top-8 z-20 flex flex-wrap justify-center gap-1 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg">
          {ADD_TYPES.map(({ type, label }) => (
            <button
              key={type}
              type="button"
              className="rounded px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
              onClick={() => {
                onInsert(type);
                setOpen(false);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BlockPreview({ block, onOpen }: { block: EmailBlock; onOpen: () => void }) {
  if (block.type === "heading" || block.type === "text") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="w-full px-3 py-2 text-left text-sm"
        dangerouslySetInnerHTML={{ __html: block.html || "<p><em>Пусто</em></p>" }}
      />
    );
  }
  if (block.type === "button") {
    return (
      <button type="button" onClick={onOpen} className="w-full px-3 py-3 text-center">
        <span
          className="inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white"
          style={{ background: block.color || "#0f3d2e" }}
        >
          {block.label || "Кнопка"}
        </span>
      </button>
    );
  }
  return (
    <button type="button" onClick={onOpen} className="w-full px-3 py-3 text-center">
      {block.src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={block.src}
          alt={block.alt || ""}
          className="mx-auto max-h-48 max-w-full object-contain"
        />
      ) : (
        <span className="text-xs text-zinc-400">
          Изображение — нажмите, чтобы загрузить
        </span>
      )}
    </button>
  );
}

function BlockSettingsModal({
  block,
  onChange,
  onClose,
}: {
  block: EmailBlock;
  onChange: (patch: Partial<EmailBlock>) => void;
  onClose: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function uploadFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      // Same auth/refresh path as the rest of admin — raw fetch skipped token refresh
      // and surfaced bare "Unauthorized" via alert(), leaving Save stuck on a hung refresh.
      const data = await adminFetch<{ public_url?: string }>("/api/admin/email/assets", {
        method: "POST",
        body: form,
      });
      if (data.public_url) {
        let naturalWidth: number | undefined;
        let naturalHeight: number | undefined;
        const objectUrl = URL.createObjectURL(file);
        try {
          const fromFile = await loadImageNaturalSize(objectUrl);
          naturalWidth = fromFile.width;
          naturalHeight = fromFile.height;
        } catch {
          try {
            const fromUrl = await loadImageNaturalSize(data.public_url);
            naturalWidth = fromUrl.width;
            naturalHeight = fromUrl.height;
          } catch {
            /* send path still probes dimensions */
          }
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
        onChange({
          src: data.public_url,
          ...(naturalWidth && naturalHeight
            ? { naturalWidth, naturalHeight }
            : {}),
        } as Partial<EmailBlock>);
      } else {
        setUploadError("Сервер не вернул ссылку на файл");
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-200 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <h3 className="font-semibold">Элемент</h3>
          <button type="button" onClick={onClose} className="p-1 text-zinc-500 hover:text-zinc-800">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-3 p-4">
          {(block.type === "text" || block.type === "heading") && (
            <>
              <RichToolbar
                onCommand={(cmd) => {
                  document.execCommand(cmd);
                }}
                onInsertName={() => {
                  document.execCommand("insertText", false, "{{name}}");
                }}
              />
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-zinc-500">
                  Шрифт
                  <select
                    className={`${inputCls} mt-1`}
                    value={block.fontFamily ?? "system"}
                    onChange={(e) =>
                      onChange({
                        fontFamily: e.target.value as BlockFontFamily,
                      } as Partial<EmailBlock>)
                    }
                  >
                    {FONT_FAMILY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-zinc-500">
                  Размер
                  <select
                    className={`${inputCls} mt-1`}
                    value={
                      block.fontSize ?? (block.type === "heading" ? "xl" : "md")
                    }
                    onChange={(e) =>
                      onChange({
                        fontSize: e.target.value as BlockFontSize,
                      } as Partial<EmailBlock>)
                    }
                  >
                    <option value="sm">Мелкий</option>
                    <option value="md">Обычный</option>
                    <option value="lg">Крупный</option>
                    <option value="xl">Заголовок</option>
                  </select>
                </label>
              </div>
              <div
                className="email-richtext min-h-[140px] rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 [&_h1]:m-0 [&_h2]:m-0 [&_h3]:m-0 [&_p]:m-0 [&_p]:p-0"
                style={{
                  fontFamily:
                    block.fontFamily === "georgia"
                      ? "Georgia, serif"
                      : block.fontFamily === "times"
                        ? "'Times New Roman', Times, serif"
                        : block.fontFamily === "verdana"
                          ? "Verdana, Geneva, sans-serif"
                          : block.fontFamily === "arial"
                            ? "Arial, Helvetica, sans-serif"
                            : "system-ui, sans-serif",
                  lineHeight: 1.55,
                }}
                contentEditable
                suppressContentEditableWarning
                dangerouslySetInnerHTML={{ __html: block.html }}
                onPaste={(e) => {
                  e.preventDefault();
                  const raw =
                    e.clipboardData.getData("text/html") ||
                    e.clipboardData.getData("text/plain");
                  const clean = sanitizeEmailRichHtml(
                    raw.includes("<") ? raw : `<p>${raw.replace(/\n/g, "<br>")}</p>`,
                  );
                  document.execCommand("insertHTML", false, clean);
                }}
                onBlur={(e) =>
                  onChange({
                    html: sanitizeEmailRichHtml(e.currentTarget.innerHTML),
                  } as Partial<EmailBlock>)
                }
              />
              <p className="text-[11px] text-zinc-400">
                Enter — новый абзац без лишнего зазора; пустая строка (два Enter) — пустая строка в
                письме; Shift+Enter — перенос без абзаца. Плейсхолдер {"{{name}}"} подставится при
                отправке.
              </p>
            </>
          )}

          {block.type === "image" && (
            <>
              {block.src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={block.src} alt={block.alt} className="mx-auto max-h-40 object-contain" />
              ) : null}
              <label className="block text-xs text-zinc-500">
                Файл {uploading ? "(загрузка…)" : ""}
                <input
                  type="file"
                  accept="image/*"
                  className="mt-1 block w-full text-sm"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
              {uploadError ? (
                <p className="text-sm text-rose-600">{uploadError}</p>
              ) : null}
              <label className="block text-xs text-zinc-500">
                ALT (если картинки отключены)
                <input
                  className={`${inputCls} mt-1`}
                  value={block.alt}
                  onChange={(e) => onChange({ alt: e.target.value } as Partial<EmailBlock>)}
                />
              </label>
              <label className="block text-xs text-zinc-500">
                Ссылка
                <input
                  className={`${inputCls} mt-1`}
                  value={block.href ?? ""}
                  onChange={(e) => onChange({ href: e.target.value } as Partial<EmailBlock>)}
                />
              </label>
              <label className="block text-xs text-zinc-500">
                Ширина (например 100% или 240px)
                <input
                  className={`${inputCls} mt-1`}
                  value={block.width ?? ""}
                  onChange={(e) => onChange({ width: e.target.value } as Partial<EmailBlock>)}
                />
              </label>
            </>
          )}

          {block.type === "button" && (
            <>
              <label className="block text-xs text-zinc-500">
                Надпись на кнопке
                <input
                  className={`${inputCls} mt-1`}
                  value={block.label}
                  onChange={(e) => onChange({ label: e.target.value } as Partial<EmailBlock>)}
                />
              </label>
              <label className="block text-xs text-zinc-500">
                Ссылка
                <input
                  className={`${inputCls} mt-1`}
                  value={block.href}
                  onChange={(e) => onChange({ href: e.target.value } as Partial<EmailBlock>)}
                />
              </label>
              <label className="block text-xs text-zinc-500">
                Цвет кнопки
                <input
                  type="color"
                  className="mt-1 h-9 w-full cursor-pointer rounded border border-zinc-300"
                  value={block.color || "#0f3d2e"}
                  onChange={(e) => onChange({ color: e.target.value } as Partial<EmailBlock>)}
                />
              </label>
            </>
          )}

          <AlignRow
            value={block.align ?? "left"}
            onChange={(align) => onChange({ align } as Partial<EmailBlock>)}
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-zinc-500">
              Отступ сверху (px)
              <input
                type="number"
                className={`${inputCls} mt-1`}
                value={block.marginTop ?? 0}
                onChange={(e) =>
                  onChange({ marginTop: Number(e.target.value) || 0 } as Partial<EmailBlock>)
                }
              />
            </label>
            <label className="text-xs text-zinc-500">
              Отступ снизу (px)
              <input
                type="number"
                className={`${inputCls} mt-1`}
                value={block.marginBottom ?? 0}
                onChange={(e) =>
                  onChange({ marginBottom: Number(e.target.value) || 0 } as Partial<EmailBlock>)
                }
              />
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}

function RichToolbar({
  onCommand,
  onInsertName,
}: {
  onCommand: (cmd: string) => void;
  onInsertName: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1">
      {[
        ["bold", "B"],
        ["italic", "I"],
        ["strikeThrough", "S"],
        ["insertUnorderedList", "•"],
        ["createLink", "🔗"],
      ].map(([cmd, label]) => (
        <button
          key={cmd}
          type="button"
          className="rounded px-2 py-1 text-xs font-semibold text-zinc-700 hover:bg-white"
          onMouseDown={(e) => {
            e.preventDefault();
            if (cmd === "createLink") {
              const url = window.prompt("URL ссылки");
              if (url) document.execCommand("createLink", false, url);
              return;
            }
            onCommand(cmd);
          }}
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        className="rounded px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-white"
        title="Вставить имя"
        onMouseDown={(e) => {
          e.preventDefault();
          onInsertName();
        }}
      >
        {"{{name}}"}
      </button>
    </div>
  );
}

function AlignRow({
  value,
  onChange,
}: {
  value: BlockAlign;
  onChange: (a: BlockAlign) => void;
}) {
  const opts: BlockAlign[] = ["left", "center", "right"];
  return (
    <div>
      <div className="mb-1 text-xs text-zinc-500">Выравнивание</div>
      <div className="flex gap-1">
        {opts.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => onChange(a)}
            className={`rounded-lg px-3 py-1 text-xs ${
              value === a ? "bg-emerald-600 text-white" : "border border-zinc-300 text-zinc-600"
            }`}
          >
            {a === "left" ? "←" : a === "center" ? "↔" : "→"}
          </button>
        ))}
      </div>
    </div>
  );
}
