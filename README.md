# ToT Victory Forecaster

A Civilization VII mod that augments the in-game **Victories** screen with a forecast strip
under each victory card, naming the civ projected to cross the threshold when the Point Goal
next drops.

No button, no popup, no user interaction. Install it and the screen simply gains extra rows.

## What it adds

Under each victory column on the Victories screen:

```
FORECAST — NEXT POINT GOAL DROPS
▶ Substantive Victory ×1.5        60% age · ~9t
✓ Sayyida al Hurra ON TRACK          690 / 459
· Narrow Victory ×1.25                  80% age
✓ Sayyida al Hurra ON TRACK          812 / 402
Projected from recent score rate · 5-turn countdown follows
```

For the Scientific column it instead shows the race to 100 Innovation with a per-civ ETA.

## How ToT victories actually work

Verified against the shipped 1.4.0 game files, not guessed.

The required lead over second place steps **down** as **age progress percentage** rises.
The ladder lives in `Base/modules/base-standard/data/victories.xml`, table
`<VictoryDominationPercents>`, and the multiplier is `(DominationPercent + 100) / 100`.

Standard Antiquity-start campaign, Modern age (`PreviousAgeCount="2"`):

| Age progress | `DominationPercent` | Multiplier | Tier |
|-------------:|--------------------:|-----------:|------|
| ≥ 0%  | 300 | 4.00× | Crushing Victory |
| ≥ 20% | 200 | 3.00× | Decisive Victory |
| ≥ 40% | 100 | 2.00× | Momentous Victory |
| ≥ 60% | 50  | 1.50× | Substantive Victory |
| ≥ 80% | 25  | 1.25× | Narrow Victory |

A Modern-age-only start (`AGE_MODERN`, `PreviousAgeCount="0"`) has just the last three rows,
and an Exploration-age game has its own set topped by Transcendent Victory at 6×.

**The mod never hardcodes this.** It reads `GameInfo.VictoryDominationPercents` at runtime
using the same filter the game's own tooltip uses (campaign start age + `previousAgeCount`),
so a rules mod or a future patch that edits those rows is picked up automatically. The table
above is documentation only.

**Scientific victory is not a domination victory** — it has no rows in that table. It is a
flat race to **100 Innovation**, then an **active Launch Pad held for 5 turns**.

Crossing a threshold starts a **5-turn countdown**. Dropping back below it **pauses** the
countdown — progress is saved, not reset. You can fall below either by losing points or by
second place gaining enough to push the goal back up.

> Note: `Base/modules/base-standard/text/en_us/AdvisorText.xml` still ships a **stale
> pre-1.4.0 tier table** that contradicts `victories.xml` (and contradicts itself). Ignore it;
> `victories.xml`, the Civilopedia, and the live tooltip all agree with the table above.

## How the forecast is computed

Score-per-turn is not exposed by the API, so the mod samples each civ's score once per turn
and estimates a linear rate over a rolling 12-turn window.

- **With ≥2 samples** — scores are projected forward to the turn the next tier begins, using
  the observed age-progress rate to convert "60% age progress" into a turn count.
- **With <2 samples** (just installed, or freshly loaded) — scores are held flat. That still
  answers a genuinely useful question exactly: *would the lower threshold already be satisfied
  by the standings as they stand?* The footer says which mode is active.

Only the projected leader can be ON TRACK for a dominance victory, since the goal is defined
as a multiple of *second* place.

## Game APIs used

| Purpose | API |
|---|---|
| Age progress % | `Game.AgeProgressManager.getCurrentAgeProgressionPoints() / getMaxAgeProgressionPoints()` |
| Tier ladder | `GameInfo.VictoryDominationPercents` |
| Point Goal | `Game.VictoryManager.getCountdownVictoryDominanceScore(hash)` |
| Per-civ score | `player.Victories.getPointsForVictoryType(hash)` |
| Tier change event | `engine.on('VictoryThresholdChanged', …)` |
| Campaign shape | `Configuration.getGame().campaignStartAgeType` / `.previousAgeCount` |

The screen itself is `screen-victory-progress`, rebuilt in SolidJS under
`Base/modules/base-standard/ui-next/screens/victories/`. The mod injects into
`[data-name="SummaryVictoryCard"]` / `.victories-summary-box`, matching the victory type via
the per-card classes `victories-summary-{cultural,economic,military,scientific}`.

## Runtime layout

```
civ7-tot-victory-forecaster.modinfo           — manifest (UIScripts, not ImportFiles)
ui/victory-forecaster/victory-forecaster.js   — the whole mod
text/en_us/ModInfoText.xml                    — mod browser strings
text/en_us/InGameText.xml                     — in-game strings
scripts/install.sh                            — symlink installer (macOS)
scripts/view_logs.sh                          — stream [TOT-VF] console output
scripts/upload_workshop.sh                    — steamcmd Workshop upload
docs/HANDOFF.md                               — confidence table + verification steps
```

`UIScripts` is required rather than `ImportFiles`: this mod **adds** a script rather than
overriding a base-game file. `ImportFiles` only replaces a path that already exists in the
VFS, so pointing it at a new path silently loads nothing.

## Install

```bash
./scripts/install.sh
```

Enable **ToT Victory Forecaster [Local Dev]** in Additional Content, then restart Civ7.

```bash
./scripts/view_logs.sh   # stream [TOT-VF] output
```

## Verifying

1. Load a Modern-age save and open the Victories screen (trophy button on the HUD).
2. Each of the four cards should show a `FORECAST` block beneath the player list.
3. Check `./scripts/view_logs.sh` for the one-shot `[TOT-VF] diagnostics` line. It dumps the
   detected age %, the tier ladder read from the database, and the top two civs per victory.
   That line confirms every assumption in one go — if the forecast looks wrong, it says why.
4. Cross-check one column by hand: hover the card for the game's own tooltip and confirm the
   mod's "next tier" multiplier and percentage match the tooltip's `Next:` line.

## Status

This mod has **not yet been run in-game**. See [`docs/HANDOFF.md`](docs/HANDOFF.md) for
what is confirmed vs inferred, how to validate against your local Civ7 install, and how to
read the startup diagnostics line.

## Roadmap

- **Phase 1** (current): forecast strip on the Summary tab, Modern age focus
- **Phase 2**: badges on individual player rows; per-victory detail tabs
- **Phase 3**: countdown-aware forecasting (pause/resume), Exploration-age tiers
