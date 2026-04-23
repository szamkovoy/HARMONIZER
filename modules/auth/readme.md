# modules/auth

Авторизация через Apple Sign-In и Google Sign-In с хранением сессии в Supabase.

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
| `signInWithApple()` | нативный Apple flow (только iOS 13.3+) |
| `signInWithGoogle()` | нативный Google flow |
| `signOut()` | выход с очисткой Google-кэша |
| `refreshProfile()` | перечитать `public.users` (после онбординга) |

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
refresh token обновляется автоматом (+ подписка на `AppState`).

## Требуемые env-переменные

См. `.env.example`. Минимум для работы auth:

```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=

# Google
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=        # OAuth 2.0 Client ID типа "Web"
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=        # OAuth 2.0 Client ID типа "iOS"
EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME=       # обратный iOS Client ID (подставится
                                         # в iOS URL Schemes при prebuild)
```

## Настройка со стороны облачных сервисов

1. **Supabase → Authentication → Providers**: включить Apple и Google,
   указать Web Client ID (Google) и Services ID + приватный ключ `.p8` (Apple).
2. **Google Cloud Console**: создать три OAuth Client ID — iOS, Android, Web.
   Обратный iOS Client ID (формата `com.googleusercontent.apps.xxxx`) кладём
   в `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME`.
3. **Apple Developer**: в `Identifiers` у App ID включить capability
   "Sign in with Apple". `expo-apple-authentication` добавляет нужный
   entitlement при prebuild.
