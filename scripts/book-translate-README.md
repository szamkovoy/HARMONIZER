# Book literary translation (FR / IT / ES / PT / NL)

Pipeline for Phase C locales. Source of truth for meaning: **English** (`book/Book_En.docx`), with German/Russian only as sense-check when a passage is unclear.

## Prompt

See `scripts/book-translate-prompt.md` (system instructions for the LLM).

## Commands

```bash
# 1) Extract EN markdown + media (once)
pandoc book/Book_En.docx -t markdown \
  --extract-media=book/translations/_media \
  -o book/translations/en/book.md
node scripts/book-split-chapters.mjs

# 2) Translate (premium Gemini; resume-safe loop — best in Terminal.app)
#    DeepSeek premium in .env may be unpaid → use Gemini 3.1 Pro.
open book/translations/run-translate.command
# or:
./scripts/book-translate-run.sh

# One locale / one chapter:
node scripts/book-translate.mjs --locale fr --only 002-prologue --provider gemini

# Progress:
tail -f book/translations/translate.log

# 3) Assemble DOCX (temp cover ← cover_En.jpg if missing)
node scripts/book-assemble-docx.mjs --all

# 4) Build EPUBs for Dev Metro /hz-book
for loc in fr it es pt nl; do
  node scripts/book-build-epub.mjs "$loc"
done
```

## Model note

`AI_MODEL_PREMIUM` in `.env.local` may point at DeepSeek; if balance is empty, use `--provider gemini --model gemini-3.1-pro-preview` (requires `GEMINI_API_KEY`).

## After covers exist

Replace `book/cover_Fr.jpg` … `cover_Nl.jpg`, then rebuild EPUBs.
