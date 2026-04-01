# Технологический стек HARMONIZER

## Frontend & Framework
- **Next.js 15+** (App Router).
- **Deployment:** Vercel.
- **Repository:** GitHub.

## Backend & Database
- **Supabase:** Auth, PostgreSQL, Storage.
- **API Integration:** Hume AI (Speech Prosody), OpenAI (Whisper, GPT-4o).

## Environment Variables (.env.local)
Все API-ключи хранятся в `.env.local`. В коде использовать `process.env`.
Ключи:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `HUME_API_KEY`
- `OPENAI_API_KEY`