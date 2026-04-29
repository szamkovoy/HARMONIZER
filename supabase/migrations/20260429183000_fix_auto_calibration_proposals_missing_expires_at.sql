-- Fix auto-calibration proposals missing expiresAt (avoid eternal pending in clients without fallback)

UPDATE public.user_settings us
SET preferences = jsonb_set(
  preferences,
  '{autoCalibrationProposal,expiresAt}',
  to_jsonb(
    (
      COALESCE(
        COALESCE(
          NULLIF(trim(preferences->'autoCalibrationProposal'->>'createdAt'), '')::timestamptz,
          NULLIF(trim(preferences->'autoCalibrationProposal'->>'suggestedAt'), '')::timestamptz
        ) + interval '14 days',
        now() + interval '1 day'
      )
    )::text
  )
)
WHERE preferences->'autoCalibrationProposal' IS NOT NULL
  AND preferences->'autoCalibrationProposal'->>'status' = 'pending'
  AND (
    preferences->'autoCalibrationProposal'->'expiresAt' IS NULL
    OR preferences->'autoCalibrationProposal'->>'expiresAt' IS NULL
    OR btrim(preferences->'autoCalibrationProposal'->>'expiresAt') = ''
  );
