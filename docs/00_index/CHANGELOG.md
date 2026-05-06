---

## id: 00_index/CHANGELOG
title: Documentation Changelog
version: 1.0
updated: 2026-05-06
depends_on: [docs/_proposal]
code_refs: [docs/_proposal.md]

## Changelog

- 2026-05-06: миграция модуля `calibration`. Источники: `docs/modules/calibration_and_orchestrator.md`, `docs/tmp_docs/29042026/MODULE_3_Calibration_TZ.md`, `docs/tmp_docs/29042026/PATCH_1_M3_averaging_ratio.md`, `docs/tmp_docs/29042026/PATCH_6_proposal_pending_fix.md`, `docs/tmp_docs/29042026/chakra_states_baseline.json.txt`. Перенесены в архив: `docs/05_archive/migrated/calibration/calibration_and_orchestrator.md`, `docs/05_archive/migrated/calibration/MODULE_3_Calibration_TZ.md`, `docs/05_archive/migrated/calibration/PATCH_1_M3_averaging_ratio.md`, `docs/05_archive/migrated/calibration/PATCH_6_proposal_pending_fix.md`, `docs/05_archive/research_assets/calibration/chakra_states_baseline.json.txt`.
- 2026-05-06: миграция модуля `infra`. Источники: `docs/tmp_docs/29042026/PATCH_5_RLS_tightening.md`, `docs/tmp_docs/29042026/PATCH_11_whisper_quality.md`, `docs/tech_stack.md` (сверка по PWA/API), `docs/remote-play/README.md` (секция Remote Play для `pwa.md`), `docs/android-adaptation-notes.md` (только перекрёстные пометки в `history.md`). Перенесены в архив: `docs/05_archive/migrated/infra/PATCH_5_RLS_tightening.md`, `docs/05_archive/migrated/infra/PATCH_11_whisper_quality.md`.
- 2026-05-06: миграция модуля `bindu`. Источники: `docs/modules/bindu_succession_lab.md`, `docs/modules/bindu_succession_visual_spec_v2.md`, `docs/modules/mandala.md`, `docs/meditation_video_generator_spec.md`, `docs/modules/visual_module_map.md`. Перенесены в архив: `docs/05_archive/migrated/bindu/bindu_succession_lab.md`, `docs/05_archive/migrated/bindu/bindu_succession_visual_spec_v2.md`, `docs/05_archive/migrated/bindu/mandala.md`, `docs/05_archive/migrated/bindu/meditation_video_generator_spec.md`, `docs/05_archive/migrated/bindu/visual_module_map.md`.
- 2026-05-06: создан `03_rules/migration_protocol.md` как стандарт разовой миграции модуля по референсу `audio`.
- 2026-05-06: миграция модуля `audio`. Источники: `docs/modules/mandala_sound.md`, `docs/tmp_docs/Мандала/Звук.txt`. Перенесены в архив: `docs/05_archive/migrated/audio/mandala_sound.md`, `docs/05_archive/migrated/audio/Звук.txt`.
- 2026-05-06: создан скелет новой документации по `_proposal.md`. Старая документация продолжает функционировать параллельно до завершения миграции.
- 2026-05-06: в новой структуре создано `75` файлов и `26` папок. Старая структура `docs/` оставлена нетронутой и продолжает существовать параллельно.
- 2026-05-06: скорректирован `00_index/MAP.md`: зависимости приведены к двусторонней согласованности, запись `error_tracking` убрана как отдельная строка, а `report` удалён из зависимых модулей `practices`.