# BMS first run

Procedure for the first run of the BMS reader on the real JK BMS. Record
results in the table at the end.

## Before you start

- Build once: `cd eam_server && npm install && npx nest build`.
- In the app, open the inverter's **Settings** and add the BMS under
  **Battery monitor (BMS)**, reading it with the Mac Bluetooth reader. Copy
  the two lines it shows (`BMS_INGEST_URL`, `BMS_INGEST_TOKEN`) into the
  `.env` the reader uses. (They can also stay empty for this run: the reader
  then only captures.)
- Leave `BMS_PROTOCOL` at its default, `JK02_32S`.

## 1. Find the BMS

1. Close the JK phone app (it holds the Bluetooth connection).
2. Bring the MacBook within a couple of metres of the BMS.
3. Run `npm run bms-reader -- --scan`. macOS asks to allow Bluetooth for the
   terminal or IDE: allow it, then scan again.
4. Note the BMS's name (usually `JK-...` or `JK_...`), its id, and its signal
   strength. If the name does not start with `JK-`, set `BMS_NAME` to its
   prefix; with several BMSes near, set `BMS_ID` to its id.

## 2. Capture about 10 minutes

1. Run `npm run bms-reader`.
2. Watch for `Connected to ...`, then a `device-info` line, then a status
   line every minute.
3. After about 10 minutes stop it with Ctrl+C. The capture is in
   `eam_server/.dev-captures/bms/<start time>.jsonl`; keep it.

## 3. Check the protocol variant

1. From the `device-info` line, note the model, hardware version and software
   version.
2. If the reader printed a `variant-warning`, or the values in the status
   lines look wrong (pack voltage near 0 or absurd, cells not ~3.2-3.4 V),
   re-decode the same capture with the other variant without reconnecting:

   ```bash
   BMS_PROTOCOL=JK02_24S npm run bms-reader -- --decode .dev-captures/bms/<file>.jsonl
   ```

   The right variant gives an 8-cell pack around 26-29 V with every cell near
   3.2-3.4 V. Set `BMS_PROTOCOL` to it in the reader's `.env`.

## 4. Compare with the JK phone app

1. Stop the reader. Open the JK phone app and connect.
2. Compare with the reader's last readings (status lines, or `--decode` of
   the capture): pack voltage, state of charge, every cell voltage, the
   temperatures.
3. Differences beyond display rounding (1 mV per cell, 0.01 V pack, 0.1 °C)
   mean a decoder bug: keep the capture; the raw frames are in it.

## 5. Pin real frames as test fixtures

From the capture, copy one device-info frame (`"frameType":3`) and one
cell-info frame (`"frameType":2`) as hex. They become test vectors in
`eam_server/src/bms/jk/testing/` next to the reference ones, with the values
you read in the phone app as the expected results. The device-info frame
contains the BMS passcodes; replace bytes 62-77 and 97-133 with zeros (and
fix the checksum at byte 299) before committing it.

## 6. Cross-check against the inverter

At one moment, note:

- BMS pack voltage vs the inverter's battery voltage (dashboard, Battery
  voltage). They should be close; a gap of a few tenths of a volt from cable
  drop is expected.
- BMS state of charge vs the inverter's estimate.

## 7. Confirm the current sign

Pick a moment when the direction is certain:

- charging: the inverter charging from the grid (Mains mode, charger on), or
- discharging: the battery carrying the load at night (off-grid).

Check that the reader's current (and power) is **positive while charging and
negative while discharging**.

- If it matches, write "confirmed on <date>, <model>" into the doc comment
  of `currentA` in `eam_server/src/bms/reading.ts`, and turn on the BMS
  values in the energy flow: in the app's **Settings > Battery monitor
  (BMS)**, tick "Use for the battery in the energy flow" for the BMS.
- If it is the other way round, do not turn it on: the decoder needs a sign
  fix first.

## 8. Phone app and reader at the same time

With the reader connected, try connecting the JK phone app. Record whether it
can connect while the reader is attached, and note the result in the
README's "Battery (BMS) reader" section.

## Results

| Item | Result |
|---|---|
| Date | 2026-10-06 to 2026-10-07 |
| BMS name / id / signal | `512262449000576-14` / `1679979376e9b5d0eee5474324a68382` (reader Mac) / -73 dBm |
| Model, hardware, software | JK-PB2A16S20P, 19U, 19.28 |
| `BMS_PROTOCOL` that decodes correctly | JK02_32S |
| Phone app comparison (differences) | |
| BMS pack voltage vs inverter battery voltage | |
| BMS SOC vs inverter SOC | |
| Current sign (charging / discharging) | Positive while charging, negative while discharging; matches the BMS display |
| Phone app while reader attached | Cannot connect |
