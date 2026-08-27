# modules/auth

Email-OTP авторизация (Supabase) с хранением сессии в SecureStore. На Android — Restore Credentials (Zero-Tap Sign-In при смене устройства).

## Public API

```ts
import { AuthProvider, useAuth } from "@/modules/auth";
```

`useAuth()` возвращает:

| Поле / метод | Назначение |
| --- | --- |
| `session` | `Session \| null` — supabase session |
| `authUser` | `User \| null` — сокращение для `session?.user` |
| `profile` | строка из `public.users` (tz, lat, lon, onboarded_at…) или null пока не загружена |
| `initializing` | true пока не прочитали сохранённую сессию из SecureStore |
| `signingIn` | true во время вызова sign-in/out |
| `requestEmailCode(email, name?)` | запрос OTP на email |
| `verifyEmailCode(email, code, name?)` | проверка OTP → сессия |
| `signOut()` | выход (+ revoke Restore Credential на Android) |
| `refreshProfile()` | перечитать `public.users` (после онбординга) |

## Android Restore Credentials (Zero-Tap)

- Native: `harmonizer-android-restore-credentials` (Credential Manager API).
- Client: `modules/auth/restoreCredentials.ts` — provision после входа, silent restore на cold start, revoke при выходе.
- Server: `POST /api/auth/restore-credential/*` на Vercel + таблицы `user_restore_credentials`, `restore_credential_challenges` (миграция `20260826120000_restore_credentials.sql`).
- **Требует новый Android dev/prod client** (не работает в старом dev-client без native-модуля).
- Vercel (опционально, строже origin): `WEBAUTHN_ANDROID_ORIGINS` — JSON `{ "com.zamkovoi.harmonizer": "android:apk-key-hash:…" }` per package variant.

## Android R8 (release builds)

В `app.config.ts` → `expo-build-properties`: `enableMinifyInReleaseBuilds`, ProGuard rules в `plugins/android-proguard-rules.pro`. Влияет только на store release AAB, не на dev-client Metro.

## Как подключено

`app/_layout.tsx` оборачивает всё приложение:

```tsx
<AuthProvider>
  <RootLayoutNav />
</AuthProvider>
```

Роут-гейт `useAuthRouteGate()` (см. `app/_layout.tsx`) автоматически
редиректит:

- нет сессии → `/sign-in`;
- есть сессия, но `profile.onboarded_at` пустой → `/onboarding`;
- всё готово → текущий запрошенный маршрут (по умолчанию `(tabs)`).

## Хранение токенов

`services/supabase.ts` передаёт supabase-js адаптер `expo-secure-store`:
iOS Keychain / Android Keystore. Сессия переживает перезапуск приложения,
refresh token обновляется автоматом (+ подписка на `AppState`). Мёртвый refresh
token (отзыв на сервере) очищается локально без красного LogBox; при валидном
токене перезапуск Metro (`expo start -c`) не сбрасывает вход.

## Требуемые env-переменные

См. `.env.example`. Минимум для работы auth:

```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_COMMUNICATOR_API_URL=   # Vercel origin для OTP-gate и Restore Credentials API
```

Сервер (Vercel): опционально `WEBAUTHN_ANDROID_ORIGINS` — см. § Android Restore Credentials выше.
