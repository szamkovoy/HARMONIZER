# Access Module

Единый слой feature gates для первого витка тарифной модели.

## Тарифы

- `free` — общий прогноз и профиль.
- `oracle` — персональный прогноз и калибровка.
- `practitioner` — Oracle + ассистент, дыхание, медитации и каталог практик.
- `master` — Practitioner + асаны, вебинары/community.

`trial_expires_at > now()` считается временным `master`. Dev override живет локально в `AccessProvider` и не меняет Supabase.

## API

- `getEffectiveAccess(profile, devOverride)`;
- `canUseFeature(tier, feature)`;
- `requiredTierFor(feature)`;
- `useAccess()`.

UI:

- `DevTierSwitch`;
- `UpgradeDialog`.
