# ToT Victory Forecaster

A Civilization VII mod that annotates the in-game **Victories** screen so you can see, at a
glance, which civ is about to trigger a victory countdown — and why.

It adds no panel and no button. It augments what the base screen already draws.

## What it adds

**1. A red score on the leaderboard.** Any civ whose *current* score already clears the goal
the **next** tier will set turns red. That civ starts a victory countdown the moment the Point
Goal drops. Only the leader can ever qualify — the goal is a multiple greater than 1 of
*second* place, so nobody below first can clear it.

**2. Numbers in the card's hover tooltip.** Each victory-tier section gains the Point Goal that
tier produces and the arithmetic behind it:

```
MOMENTOUS VICTORY
Required: 2x the Second Place Player's score before 60% Age Progress
──────────────────────────────────────────
Point Goal 612  =  ×2 of 2nd place (Pachacuti 306)
Sayyida al Hurra leads on 514 — 98 short

NEXT: SUBSTANTIVE VICTORY
Required: 1.5x the Second Place Player's score before 80% Age Progress
──────────────────────────────────────────
Point Goal 459  =  ×1.5 of 2nd place (Pachacuti 306)
⚠ Sayyida al Hurra (514) already clears this — countdown starts at 60% Age Progress
```

The derivation shows even when no countdown is imminent, because "×1.5" is meaningless without
knowing which number it multiplies.

**Everything is exact arithmetic over current standings — there is no projection anywhere.**
The Point Goal falls because the *multiplier* drops, not because anyone's score moves, so
current scores are the honest input. An earlier revision extrapolated score rates and produced
figures that contradicted the leaderboard on the same card; that code is gone.

The "in force" section uses the game's own `getCountdownVictoryDominanceScore`, so the mod's
arithmetic is checked against the number printed at the top of the card on every hover. If
they ever disagree, the mod is wrong and you will see it.

Civs the local player has not met stay anonymised as **Unmet civ**, matching the base screen.

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

A Modern-age-only start (`AGE_MODERN`, `PreviousAgeCount="0"`) has just the last three rows.
An Exploration **start** (`AGE_EXPLORATION`, `PreviousAgeCount="1"`) gets the same five as
above. Transcendent Victory (6×, `DominationPercent="500"`) is not an Exploration-start tier
at all — it only exists for an Antiquity-start campaign with `PreviousAgeCount="1"`, i.e.
while that campaign is still in the Exploration age.

**The mod never hardcodes this.** It reads `GameInfo.VictoryDominationPercents` at runtime
using the same filter the game's own tooltip uses (campaign start age + `previousAgeCount`),
so a rules mod or a future patch that edits those rows is picked up automatically. The table
above is documentation only.

**Scientific victory is not a domination victory** — it has no rows in that table. Its row in
`<VictoryTypes>` reads `ScoringType="COUNTDOWN_VICTORY_SCORING_TYPE_FIXED_SCORE"`
`MinimumPoints="100"`: a flat race to 100, then the countdown. The mod reads both values from
that row rather than hardcoding them.

Crossing a threshold starts a countdown of `CountdownDuration` turns (**5** for all four
victories in the shipped data). Dropping back below it **pauses** the countdown — progress is
saved, not reset. You can fall below either by losing points or by second place gaining enough
to push the goal back up.

> Note: `Base/modules/base-standard/text/en_us/AdvisorText.xml` still ships a **stale
> pre-1.4.0 tier table** that contradicts `victories.xml` (and contradicts itself). Ignore it;
> `victories.xml`, the Civilopedia, and the live tooltip all agree with the table above.

## How the threshold is computed

```
goal(tier) = tier.multiplier × second place's CURRENT score
```

A countdown is imminent when `leader.points >= goal(next tier)`. That is the whole model.

No sampling, no rate estimation, no turn projections — all of that was removed. The only
inputs are the live scores and the tier ladder, both read fresh on every refresh.

## Game APIs used

Every entry below was read out of the installed 1.4.0 build's own
`ui-next/screens/victories/victories-screen-model.js`, so the mod calls exactly what the base
screen calls.

| Purpose | API |
|---|---|
| Age progress % | `Game.AgeProgressManager.getCurrentAgeProgressionPoints() / getMaxAgeProgressionPoints()` |
| Victory catalogue | `GameInfo.VictoryTypes` (scoring, `$hash`) joined to `GameInfo.Victories` (`VictoryClassType`) |
| Tier ladder | `GameInfo.VictoryDominationPercents` |
| Point Goal | `Game.VictoryManager.getCountdownVictoryDominanceScore(hash)` |
| Player list | `Players.getAlive()` filtered by `isMajor && Victories` |
| Per-civ score | `player.Victories.getPointsForVictoryType(hash)` |
| Countdown state | `player.Victories.getVictoryCountdownStatus(hash)` → `{ turns, isDominant }` |
| Leader label | `player.leaderName` |
| Met/unmet | `Players.get(GameContext.localPlayerID).Diplomacy.hasMet(id)` |
| Refresh events | `VictoryPointsChanged`, `VictoryDominanceChanged`, `VictoryCountdownChanged`, `VictoryThresholdChanged` |
| Campaign shape | `Configuration.getGame().campaignStartAgeType` / `.previousAgeCount` |

`Players.getAliveMajors()` does **not** exist in this build (`getAliveMajorIds()` does); the
game's own leaderboard filters `getAlive()` instead, and so does the mod.

### Where the block is injected

`ui-next/screens/victories/victories-screen.js` ends with
`defineLegacyComponent("screen-victory-progress", …)`, so the SolidJS screen registers under
the same tag as the older `ui/victory-progress/` panel and is the one that actually opens.

Each card is an `Activatable` — a plain `<div>` — carrying `data-name="SummaryVictoryCard"`
and `class="victories-summary-box …"`. The per-type classes
`victories-summary-{military,cultural,economic,scientific}` are **not** on that card: the
model passes them as `props.summaryBg`, which lands on the card's background child
`.victories-summary-bg`. The mod therefore identifies a card by reading the classes off that
child. (Matching them on the card itself was the reason an earlier revision injected nothing.)

## Runtime layout

```
civ7-tot-victory-forecaster.modinfo           — manifest (UIScripts, not ImportFiles)
ui/victory-forecaster/victory-forecaster.js   — the whole mod
text/en_us/ModInfoText.xml                    — mod browser strings
preview.png                                   — Steam Workshop preview (640×640)
workshop.vdf                                  — Workshop metadata (source of truth)
scripts/install.sh                            — copy into Mods/ (macOS)
scripts/view_logs.sh                          — stream [TOT-VF] console output
scripts/gen_preview.py                        — regenerate preview.png
scripts/build_workshop_vdf.py                 — resolve workshop.vdf for steamcmd
scripts/upload_workshop.sh                    — two-step Workshop publish
scripts/steamcmd_upload_with_keychain.expect  — steamcmd login via macOS Keychain
docs/HANDOFF.md                               — confidence table + verification steps
```

`UIScripts` is required rather than `ImportFiles`: this mod **adds** a script rather than
overriding a base-game file. `ImportFiles` only replaces a path that already exists in the
VFS, so pointing it at a new path silently loads nothing.

## Install

```bash
./scripts/install.sh
```

Enable **ToT Victory Forecaster** in Additional Content, then restart Civ7.

The installer copies the payload into `Mods/` and only clears `Mods.sqlite` when the manifest
changed — editing an already-listed script needs a game restart, not a cache wipe, so you do
not have to quit Civ7 before running it.

```bash
./scripts/view_logs.sh   # stream [TOT-VF] output
```

## Verifying

1. Load a Modern-age save and open the Victories screen (trophy button on the HUD).
2. Pick a column where the leader is well ahead. Its top score should be **red** if the leader
   already clears the next tier's goal, and normal otherwise.
3. Hover that column. Each tier section of the tooltip should carry a `Point Goal N = ×M of
   2nd place P` line, and the imminent one should name the civ.
4. **Check the mod against the game.** The "tier in force" section derives the goal itself; it
   must equal the Point Goal printed at the top of the card. If those two numbers differ, the
   mod is wrong.
5. `./scripts/view_logs.sh` shows a one-shot `[TOT-VF] diagnostics` line plus a `refresh` line
   per update:

   ```
   [TOT-VF] refresh {"reason":"dom","cards":4,"tips":1,"hot":1,"cool":3}
   ```

   `hot` counts red-scored cards, `tips` counts augmented tooltips. A `tip:unmatched` means the
   victory could not be identified from the tooltip text; `tip:noframes` means the
   `Card-Frame` sections were not found. `cards: 0` means the card selector itself is stale.

## Publishing to the Steam Workshop

Workshop item: **[3802048371](https://steamcommunity.com/sharedfiles/filedetails/?id=3802048371)**
(currently private).

```bash
./scripts/upload_workshop.sh --changenote "what changed"
```

`workshop.vdf` is the source of truth for title, description, visibility and the
`publishedfileid`. The script resolves it into build VDFs under `build/steam/`; do not edit
those by hand. Only the mod payload is staged — the modinfo, `ui/` and `text/` — because
pointing `contentfolder` at the repo root would ship `.git`, `docs/`, `scripts/` and the
README as mod content.

### The preview image cannot be uploaded by steamcmd

It has to be set by hand on the item's Edit page. This is **not** a misconfiguration — it is a
limitation of Steam's client, proven on the first publish:

```
Uploading preview image...clientugc.cpp (2069) :
    k_EPublishedFileStorageSystemLegacyCloud == eStorage
ERROR! Failed to update workshop item (Access Denied).
```

That assertion says the preview-upload path only supports items held in **legacy cloud**
storage. Civ VII items use the newer UGC storage, so the upload fails regardless of image
size, file path, or VDF shape. The two-step upload (content, then a minimal
`appid`+`publishedfileid`+`previewfile` VDF) is the correct pattern *in general* and works for
apps on legacy storage — it just cannot work here.

So `upload_workshop.sh` does not attempt it by default; it prints the Edit-page URL instead.
`--try-preview` keeps the attempt available in case Valve ever changes this. Because
`contentfolder` is optional in `workshop_build_item`, a preview-only retry leaves the uploaded
files untouched.

To set it: open
[the edit page](https://steamcommunity.com/sharedfiles/itemedittext/?id=3802048371) and upload
`preview.png`. Only needed when the image changes, not on every content update.

### Other traps, all enforced by `build_workshop_vdf.py`

- A straight `"` in the description becomes `\"` in the VDF and Steam's parser stops there,
  silently truncating everything after it. Use curly quotes; the generator refuses otherwise.
- `contentfolder` and `previewfile` must be absolute paths.
- A preview over 1 MB is rejected silently by Steam (ours is 47 KB at 640×640), and the
  preview must sit outside the content folder — both still checked, for the day this works.

Login goes through `steamcmd_upload_with_keychain.expect`, since steamcmd needs a real TTY for
its password prompt. It reads the password from the macOS Keychain (never printing it) and
surfaces Steam Guard in a dialog — with a mobile authenticator you just approve the push.
Steam **login** name is `josephcasey`; the Keychain service is `civ7-steamcmd-upload`.
Civ VII's Workshop app id is `1295660`.

## Status

**Runs in-game.** First successful smoke test 2026-09-09: the mod loads, injects into all four
victory cards (`outcomes: {"ok": 4}`), and every score it reads matches the game's own
leaderboard.

The forecast compares **current** standings against each upcoming tier's goal — no score
extrapolation, so the numbers reconcile with the card's own leaderboard. The only estimate is
the `in Nt` tier timing, from age progress.

See [`docs/HANDOFF.md`](docs/HANDOFF.md) for the full confidence table and what the smoke test
settled.

## Roadmap

- **Phase 1** (done): red leaderboard score, and goal + derivation in each tooltip tier
  section. Verified in-game against the game's own Point Goal.
- **Phase 2**: badges on individual player rows, and the per-victory detail tabs. Those rows
  are SolidJS-managed and re-render underneath any injected node — though the inline-style
  approach used for the score colour is probably the way in.
- **Localization**: the injected strings are built in JS and are English only. Moving them to
  `LOC_*` keys with `Locale.compose` args would make the mod translatable.
- **Earlier ages**: only the Modern-age countdown victories have a tier ladder, so the mod has
  nothing to say before then. Legacy-path progress could be worth surfacing separately.
