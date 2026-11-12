-- Copy shock bands into vibrate/beep only where that mode is still the
-- 20261110210000 defaults (1, 100, 16, 15000) and shock differs.
-- A mode the user has since changed is left alone. Column defaults for new rows stay as they are.

UPDATE "DiscordUser"
SET
  "activityVibMinIntensity" = "activityMinIntensity",
  "activityVibMaxIntensity" = "activityMaxIntensity",
  "activityVibMinDurationMs" = "activityMinDurationMs",
  "activityVibMaxDurationMs" = "activityMaxDurationMs"
WHERE
  "activityVibMinIntensity" = 1
  AND "activityVibMaxIntensity" = 100
  AND "activityVibMinDurationMs" = 16
  AND "activityVibMaxDurationMs" = 15000
  AND (
    "activityMinIntensity" <> 1
    OR "activityMaxIntensity" <> 100
    OR "activityMinDurationMs" <> 16
    OR "activityMaxDurationMs" <> 15000
  );

UPDATE "DiscordUser"
SET
  "activityBeepMinIntensity" = "activityMinIntensity",
  "activityBeepMaxIntensity" = "activityMaxIntensity",
  "activityBeepMinDurationMs" = "activityMinDurationMs",
  "activityBeepMaxDurationMs" = "activityMaxDurationMs"
WHERE
  "activityBeepMinIntensity" = 1
  AND "activityBeepMaxIntensity" = 100
  AND "activityBeepMinDurationMs" = 16
  AND "activityBeepMaxDurationMs" = 15000
  AND (
    "activityMinIntensity" <> 1
    OR "activityMaxIntensity" <> 100
    OR "activityMinDurationMs" <> 16
    OR "activityMaxDurationMs" <> 15000
  );

UPDATE "ActivityShare"
SET
  "vibMinIntensity" = "minIntensity",
  "vibMaxIntensity" = "maxIntensity",
  "vibMinDurationMs" = "minDurationMs",
  "vibMaxDurationMs" = "maxDurationMs"
WHERE
  "vibMinIntensity" = 1
  AND "vibMaxIntensity" = 100
  AND "vibMinDurationMs" = 16
  AND "vibMaxDurationMs" = 15000
  AND (
    "minIntensity" <> 1
    OR "maxIntensity" <> 100
    OR "minDurationMs" <> 16
    OR "maxDurationMs" <> 15000
  );

UPDATE "ActivityShare"
SET
  "beepMinIntensity" = "minIntensity",
  "beepMaxIntensity" = "maxIntensity",
  "beepMinDurationMs" = "minDurationMs",
  "beepMaxDurationMs" = "maxDurationMs"
WHERE
  "beepMinIntensity" = 1
  AND "beepMaxIntensity" = 100
  AND "beepMinDurationMs" = 16
  AND "beepMaxDurationMs" = 15000
  AND (
    "minIntensity" <> 1
    OR "maxIntensity" <> 100
    OR "minDurationMs" <> 16
    OR "maxDurationMs" <> 15000
  );
