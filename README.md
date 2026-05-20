# ToT Victory Forecaster

A Civilization VII mod that flags players as **ON TRACK** to win when their score trajectory is projected to meet an upcoming Test of Time threshold lowering in the Modern age.

## Known Good Baseline

As of May 20, 2026 this mod targets:

- **Civ7 Test of Time patch 1.4.0**
- A **"VF"** button is injected into the top-bar icon cluster (same anchor as the zoom mod)
- Clicking **VF** opens a popup showing, for each victory type, every player's current score, their rank, and whether they are **ON TRACK**

## What "ON TRACK" Means

In the ToT Dominance model (Military / Culture / Economic), the first-place player wins once their score is ≥ a multiplier × second-place score for 5 consecutive turns. The multiplier **lowers** as the Modern age progresses:

| Age-progress points | Threshold multiplier |
|--------------------:|---------------------:|
| 0 (age start)       | 3.00×                |
| ~60 pts ⚠           | 2.00×                |
| ~100 pts ⚠          | 1.50×                |
| ~150 pts ⚠          | 1.25×                |

⚠ **Threshold timing (agePoints) is estimated** — the multipliers are confirmed from the ToT Dev Diary (2026-05-19) but the exact age-progression-point values at which they change are not yet documented publicly. Update `MODERN_THRESHOLDS` in `ui/victory-forecaster/victory-forecaster.js` once in-game observation confirms the real values.

A player is flagged **ON TRACK** if their linear score projection at either of the **next two** threshold change points would satisfy: `projectedScore ≥ multiplier × projected 2nd-place score`.

For **Science Victory**: a player is ON TRACK if their innovation score rate projects to ≥ 100 before the age ends.

## Runtime Layout

```
ui/victory-forecaster/victory-forecaster.js  — main mod JS (singleton, DOM injection)
civ7-tot-victory-forecaster.modinfo          — local dev mod manifest
text/en_us/ModInfoText.xml                   — mod browser strings
text/en_us/InGameText.xml                    — in-game strings
scripts/install.sh                           — symlink installer (macOS)
scripts/view_logs.sh                         — stream [TOT-VF] console output
```

## Local Development

```bash
./scripts/install.sh
```

Then enable **ToT Victory Forecaster [Local Dev]** in Additional Content.

```bash
./scripts/view_logs.sh   # tail filtered Civ7 UI log
```

## Quick Smoke Test

1. Launch Civ7 with the mod enabled and reach the Modern age.
2. Confirm the gold-bordered **VF** button appears in the top-bar (near the turn counter).
3. Click **VF** — the popup should appear showing all players' scores per victory type.
4. Rows with a green **ON TRACK ×M** badge are projected to meet the ×M threshold.
5. If the popup shows "Could not read victory data", open the browser console and search `[TOT-VF]` for debug output — this indicates the ToT DLC uses a different API key than expected, which can be fixed by updating `CLASS_KEYS` in the JS.

## Calibrating Threshold Timing

The `agePoints` values in `MODERN_THRESHOLDS` need in-game verification:

1. Open the victory screen mid-Modern-age and note the age-progression bar.
2. Watch for the threshold to change (the UI will update the required multiplier).
3. Record the age-progression point at that moment.
4. Update the matching entry in `MODERN_THRESHOLDS` inside `victory-forecaster.js`.

## Roadmap

- **Phase 1** (current): VF popup with per-player ON TRACK forecast
- **Phase 2**: Inline badges injected directly into the victory progress screen player rows
- **Phase 3**: Calibrated threshold timing + Exploration age support
