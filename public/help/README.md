# Help center screenshots

Drop PNGs here to fill the screenshot placeholders in help articles. Until a
file exists, the article shows a labeled "Screenshot pending" placeholder, so
pages stay presentable.

Reference them from an article's `image` block as `/help/<file>.png`.

## Needed for "Fix a sensor that didn't enroll"

- **sensor-offline.png** — a sensor's detail page in the broken state: **Last
  check-in: "no check-in yet"** and **Reported config: "not yet reported."**
  (Shown in the intro as the symptom.)
- **enroll-settings.png** — Settings → SFTP ingestion → Sensor auto-enrollment,
  showing the "Allow boxes to self-enroll" checkbox (checked) and the bootstrap
  key. **Crop or blur the bootstrap key and SFTP password before saving.** (Step 1.)
- **sensor-enrolled.png** — a sensor's detail page in the healthy state: a
  recent **Last check-in** and a populated **Reported config**. (Step 6 — e.g.
  the baker-agent sensor we just fixed makes a good "after" shot.)

Tip: crop tightly to the relevant panel, ~1400px wide, and avoid capturing real
secrets (blur the bootstrap key / SFTP password if they're on screen).
