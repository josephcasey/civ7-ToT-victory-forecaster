# Handoff — state, confidence, and next steps

Read this before touching the code.

## Where things stand

The previous session wrote the mod in a cloud container with no Civilization VII
installation, so every claim about game internals came from the GitHub mirror
[`mateicanavra/civ7-official-resources`](https://github.com/mateicanavra/civ7-official-resources)
and nothing was checked against a real build.

**That validation pass has now been done**, against the installed macOS build at
`…/Steam/steamapps/common/Sid Meier's Civilization VII/CivilizationVII.app/Contents/Resources`.
It found and fixed one fatal bug and several smaller ones (below).

**The smoke test has now been run** (2026-09-09, Modern-age start, turn 1-5). The mod loads,
injects into all four cards (`outcomes: {"ok": 4}`), and every score it reads matches the
game's own leaderboard exactly. See "First run" below for what that settled and what it broke.

- `ui/victory-forecaster/victory-forecaster.js` — the entire mod, single file
- `civ7-tot-victory-forecaster.modinfo` — manifest
- JS passes `node --check`; all XML parses; installed payload matches the modinfo paths

## What verification changed

### Fatal — the mod would have injected nothing

`victoryTypeForCard()` matched `victories-summary-{cultural,economic,military,scientific}`
on the card element. Those classes are **not on the card**. `summary-victory-tab.js` renders
the card as an `Activatable` (a plain `<div>`) with only
`victories-summary-box …` + `data-name="SummaryVictoryCard"`; the model passes the per-type
class as `props.summaryBg`, which lands on the card's background child
`.victories-summary-bg`. Every card would have returned `null` → `injected: 0`.

Fixed by reading the classes off `.victories-summary-bg` (with a direct-children fallback for
Coherent GT), and by driving the whole thing from a catalogue built out of
`GameInfo.VictoryTypes` ⋈ `GameInfo.Victories` rather than a hardcoded list.

### Other corrections

| Was | Now | Why |
|---|---|---|
| `Players.getAliveMajors()` | `Players.getAlive().filter(isMajor && Victories)` | `getAliveMajors` does not exist in this build; `getAliveMajorIds` does. This is the game's own filter in `calcVictoryLeaderboard`. |
| `player.name` first | `player.leaderName` first | Both `calcVictoryLeaderboard` and `calcDominantPlayer` use `leaderName`. |
| Unmet civs named | `LOC_UI_UNMET_PLAYER_NAME` | The base screen anonymises unmet civs. Showing their names leaked standings the game withholds. |
| `SCIENCE_INNOVATION_GOAL = 100` | `VictoryTypes.MinimumPoints` | It is data (`ScoringType="…FIXED_SCORE" MinimumPoints="100"`), so a DLC can change it. |
| `COUNTDOWN_TURNS = 5` | `VictoryTypes.CountdownDuration` | Same reason. |
| Science identified by type string | identified by `ScoringType` | Type-string matching breaks on any renamed/added victory. |
| Only `VictoryThresholdChanged` | + `VictoryPointsChanged`, `VictoryDominanceChanged`, `VictoryCountdownChanged` | All three are what `victories-screen-model.js` itself subscribes to. |
| No countdown display | `⏳` line from `getVictoryCountdownStatus` | Was slated for Phase 3; the API was confirmable statically, so it landed now. |
| `Logs/Civ7_UI.log` | `Logs/UI.log` | The log is named `UI.log`. `view_logs.sh` was tailing a file that does not exist. |
| `install.sh` symlinked | copies with `rsync` | Symlink-following by Civ7 is unproven; a copy is the mechanism known to work, and a symlink failure looks exactly like a mod bug. |

One risk was *introduced and then removed*: an `isCountdownVictoryEnabled()` gate on
injection. A card only exists in the DOM when the victory is already enabled, so the gate
could only ever produce false negatives. It survives in the diagnostics line, where a wrong
value is harmless.

## Steam Workshop publishing (2026-09-15)

Published as item **3802048371**, visibility 2 (private). `workshop.vdf` now carries that id,
so further runs update it rather than creating a second item.

### The preview image genuinely cannot be uploaded by steamcmd — now proven

The earlier note in this repo said preview images *“can't be uploaded via steamcmd for this
app (newer UGC storage, not legacy cloud)”*. I researched that, concluded it was probably a
fixable misconfiguration, rebuilt the upload as two calls, and **was wrong**. The first publish
produced the actual error:

```
Uploading preview image...clientugc.cpp (2069) :
    k_EPublishedFileStorageSystemLegacyCloud == eStorage
ERROR! Failed to update workshop item (Access Denied).
```

That is an assertion inside Steam's client. Its preview-upload path only supports items on
**legacy cloud** storage; Civ VII uses the newer UGC storage, so it fails regardless of image
size, path, or VDF shape. The original note was correct, and the reason it gave was correct.
Do not spend time on this again — set the preview on the Edit page:
`https://steamcommunity.com/sharedfiles/itemedittext/?id=3802048371`

What the rework *was* still worth doing for:

- **The old script would have shipped the whole repo.** `contentfolder` was the repo root, so
  `.git`, `docs/`, `scripts/`, the README and `preview.png` would all have gone up as mod
  content. Content is now staged to `build/steam/content/` holding only the modinfo, `ui/` and
  `text/` — verified: the upload contained exactly three files.
- **Description truncation is now impossible.** A straight `"` becomes `\"` in the VDF and
  Steam's parser stops there. `build_workshop_vdf.py` refuses to generate such a VDF.
- **The two-step split is the right shape anyway** — `contentfolder` is optional in
  `workshop_build_item`, so a preview-only retry cannot clobber the content. `--try-preview`
  keeps it available if Valve ever fixes the storage-system check.

### Conventions taken from the sibling mods

- Mod id is `jc-<name>` (`jc-tot-victory-forecaster`), not the `-local` suffix it had.
- `<Authors>` is `childofwight` — the Steam display name. The Steam **login** is `josephcasey`;
  the Keychain service holding the password is `civ7-steamcmd-upload` (reused across games
  despite the civ7 name).
- Note the id is shared by the local dev copy and any subscribed Workshop copy, so subscribing
  to your own item collides with local dev. Keep the Workshop copy unsubscribed, or move it
  aside, while developing.

## Design change — the panel is retired (2026-09-14)

The appended forecast panel is **gone**. On request, the mod now augments the stock screen:
a red leaderboard score when a civ already clears the next tier's goal, and the goal plus its
derivation injected into each tier section of the card's hover tooltip.

That removed the entire sampling/projection layer — `history`, `sampleNow`, `scoreRate`,
`agePctRate`, `turnsUntilAgePct`, `MIN_SPAN_TURNS` and the block builders are all deleted.
Every displayed figure is now exact arithmetic on current standings.

Two DOM facts this relies on, both read from the installed build:

- **Score cells.** `PointGoalPanel` renders each row's score as a div with
  `font-body text-2xs self-center mr-2`. The portrait wrapper shares `mr-2 self-center` but has
  no `text-2xs`; the name field has `text-2xs` but also `victories-name-field`. That pair of
  classes minus the name field isolates the score cells in leaderboard order. Colour is applied
  as an **inline style**, never a class — the base component owns `className` via a
  `createRenderEffect` and would wipe a class of ours on its next run.
- **Tooltips.** They portal into `#uinext-tooltips` (`tooltip.js:237`). The victory card's
  tooltip carries `victories-tooltip`, and its body is a stack of `[data-name="Card-Frame"]`
  sections: `[Required Points] [tier in force] [next tier]`. The last two are conditional —
  a locked victory renders neither, and science has no tier rows at all. The mod identifies
  which victory a tooltip belongs to by matching the longform blurb (`LOC_VICTORY_*_LONGFORM`),
  which is stateless and so works for mouse, keyboard and controller alike.

Verified offline against the reference screenshot (Sayyida al Hurra 514 / Pachacuti 306,
Point Goal 612): the mod derives 612 independently — matching the game — and correctly flags
that 514 already clears the next tier's 459.

## First run — what the smoke test settled

Confirmed at runtime, from the `[TOT-VF] diagnostics` line and a screenshot of the screen:

- `outcomes: {"ok": 4}` on every refresh — injection works; the `.victories-summary-bg` class
  lookup is right, and the injected block survives Solid re-renders.
- The `<style>` block applies in Coherent GT; the block fits a 25%-wide card.
- `Configuration.getGame().previousAgeCount` **does exist** (reported `0`).
- On a Modern-age start the ladder reads `["40%:x2","60%:x1.5","80%:x1.25"]` — the
  `PreviousAgeCount="0"` row set, as expected.
- Current scores match the base leaderboard for all four victories (Cultural leader Ibn
  Battuta, Economic Napoleon, Military Ashoka, Scientific 45/45/45). `getPointsForVictoryType`,
  `leaderName` and the `getAlive()` filter are all correct.
- `hasMet` works: unmet civs showed as "An unmet Player" at turn 1 and resolved to real names
  by turn 5, matching the base screen.

What it broke, and what changed as a result:

| Symptom | Cause | Fix |
|---|---|---|
| Military card read `28` but the block said `158` | The block printed the **projected** score with nothing marking it as such, directly under a leaderboard showing the current one | Rows now render `now→projected / goal` whenever a rate is in play |
| Projections were absurd (military `8` at turn 1 → `28` at turn 5 → projected `123`) | A 4-turn slope extrapolated 19 turns. Victory points arrive in lumps and early scores ramp then flatten, so a short baseline is worthless | `MIN_SPAN_TURNS = 5`: no rate at all until the samples span 5 turns. Before that the block shows standings as-is and says `sampled 2/5t` |
| `~19t` read as `-19t` | The tilde is indistinguishable from a minus at `0.64rem` in this UI | Now `in 19t` |
| Footer claimed "projected from recent score rate" with no basis | — | Now states it: `Rate measured over 7t, projected 19t ahead — rough` |

## Confidence table — after verification

| Claim | Status | Evidence |
|---|---|---|
| Tier ladder in `<VictoryDominationPercents>`, `base-standard/data/victories.xml` | CONFIRMED | Read from the installed file |
| No DLC overrides those rows | CONFIRMED | `grep -rl VictoryDominationPercents` over all of `Resources` hits only base-standard + the two UI models |
| `multiplier = (DominationPercent + 100) / 100` | CONFIRMED | `calcTooltipForVictory` |
| Ladder 4.0×@0 / 3.0×@20 / 2.0×@40 / 1.5×@60 / 1.25×@80 (Antiquity start, `PreviousAgeCount=2`) | CONFIRMED | Installed XML rows |
| Tier names `LOC_VICTORY_NAME_1..6` = Transcendent/Crushing/Decisive/Momentous/Substantive/Narrow | CONFIRMED | `base-standard/text/en_us` |
| Type strings are `VICTORY_{CULTURE,ECONOMIC,MILITARY,SCIENCE}_MODERN` | CONFIRMED | `<Victories>` / `<VictoryTypes>`. The `VICTORY_MODERN_*` spelling in `age-modern/data/victories.xml` is inside a block commented out and marked `DEPRECATED 1.4.0` |
| Science = flat 100, no ladder | CONFIRMED | `ScoringType="…FIXED_SCORE" MinimumPoints="100"` |
| 5-turn countdown | CONFIRMED | `CountdownDuration="5"` on all four |
| `Game.AgeProgressManager.get{Current,Max}AgeProgressionPoints()` | CONFIRMED | `calcTooltipForVictory` |
| `Game.VictoryManager.getCountdownVictoryDominanceScore(hash)` | CONFIRMED | `populateData` |
| `player.Victories.getPointsForVictoryType(hash)` | CONFIRMED | `calcVictoryLeaderboard`, `calcSpreadsheetsForVictory` — was INFERRED |
| `player.Victories.getVictoryCountdownStatus(hash)` → `{turns, isDominant}` | CONFIRMED | `calcDominantPlayer` |
| `player.leaderName` | CONFIRMED | `calcVictoryLeaderboard` — was GUESSED |
| `Database.makeHash(typeString)` == `$hash` | CONFIRMED | `victories-screen.js` passes `Database.makeHash("VICTORY_CULTURE_MODERN")` where `populateData` passes `victory.$hash` |
| Card = `[data-name="SummaryVictoryCard"]` / `.victories-summary-box` | CONFIRMED | `summary-victory-tab.js` — was LIKELY |
| Per-type class lives on `.victories-summary-bg`, not the card | CONFIRMED | `props.summaryBg`, set in `populateData` — **contradicts the previous session's LIKELY claim** |
| ui-next screen overrides the older `ui/victory-progress/` one | CONFIRMED | `victories-screen.js` calls `defineLegacyComponent("screen-victory-progress", …)`, so it registers under the same tag and is loaded later in `base-standard.modinfo` — was UNCERTAIN |
| `VictoryThresholdChanged` fires as an engine event | CONFIRMED | `createEngineEvent` in `victories-popup-model.js`; `activationEngineEvents` in the tutorial items |
| `UIScripts` (not `ImportFiles`) loads a new UI script | CONFIRMED | Used by `core.modinfo`, `base-standard.modinfo`, all three age modinfos — was LIKELY |
| Appending a child to the card survives Solid re-renders | CONFIRMED | Smoke test: `outcomes: {"ok": 4}` across repeated refreshes |
| The injected `<style>` block applies in Coherent GT | CONFIRMED | Smoke test: block renders styled |
| Block fits the card (`width: 25%`, `min-height: 28.9rem`) | CONFIRMED | Smoke test: fits without clipping |

Nothing is left marked UNVERIFIED: the smoke test cleared the rendering questions. What
remains open is the **quality of the projection**, not whether the mod works.

## Step 1 — smoke test (the only thing worth doing next)

`./scripts/install.sh` has already been run: the mod is copied to
`~/Library/Application Support/Civilization VII/Mods/civ7-tot-victory-forecaster` and
`Mods.sqlite` is cleared. Re-run it after any edit.

```bash
./scripts/view_logs.sh   # leave running in a second terminal
```

Launch Civ7, enable **ToT Victory Forecaster [Local Dev]** in Additional Content, restart,
load a Modern-age save, open the Victories screen.

The mod emits one diagnostics line at startup:

```
[TOT-VF] diagnostics {"agePct":47,"extended":false,"turn":34,"age":"AGE_MODERN",
  "startAge":"AGE_ANTIQUITY","prevAgeCount":2,"majors":6,
  "summary":[{"type":"VICTORY_CULTURE_MODERN","bg":"victories-summary-cultural",
              "scoring":"COUNTDOWN_VICTORY_SCORING_TYPE_DOMINATION","goal":612,"enabled":true,
              "tiers":["0%:x4","20%:x3","40%:x2","60%:x1.5","80%:x1.25"],
              "top":["Sayyida al Hurra=514","Pachacuti=306"]}, …]}
```

Read it as a checklist:

| Field | If it is wrong |
|---|---|
| no `[TOT-VF]` output at all | The script never loaded. Check `Modding.log` for the mod path; suspect a stale `Mods.sqlite` before suspecting the code |
| `summary` empty | `buildCatalogue` matched nothing — `GameInfo.Victories` / `GameInfo.VictoryTypes` join failed |
| `agePct` null | `AgeProgressManager` method names differ |
| `startAge` not `AGE_ANTIQUITY` / `prevAgeCount` not 2 (in an Antiquity-start game) | Ladder filter will select the wrong rows |
| `tiers` empty | The `VictoryDominationPercents` filter matched nothing |
| `goal` −1 | Victory locked (expected for science outside Modern), or the signature differs |
| `majors` 0, or `top` empty/all zero | `getPointsForVictoryType` or the `getAlive()` filter is wrong |
| `top` shows `Player 3` | `leaderName` missed; find the right property |
| `top` shows `Unmet civ` for civs you have met | `Diplomacy.hasMet` is inverted or unavailable |

Then a `[TOT-VF] refresh` line each time the screen opens:

```
[TOT-VF] refresh {"reason":"dom","cards":4,"injected":4,"outcomes":{"ok":4}}
```

`outcomes` now says *why* a card was skipped rather than just counting failures:

| Outcome | Meaning |
|---|---|
| `ok` | Block injected |
| `unmatched` | No `.victories-summary-bg` class matched a catalogue entry — the DOM changed again; re-check `summary-victory-tab.js` |
| `locked` | `pointGoal` is −1. Correct for science outside the Modern age; suspicious for anything else |
| `nodata` | Fewer than 2 major players with scores |
| `error` | An exception; the preceding `inject failed` line has it |

`cards: 0` means the card selector itself is wrong — that is the only remaining single point
of failure for the injection path.

## Step 2 — cross-check one number by hand

Hover a victory card for the game's **Victory Tier Information** tooltip and confirm:

- the tooltip's `Next: <tier>` name matches the mod's second forecast row
- the tooltip's `Required: Nx … before P% Age Progress` multiplier and percentage match

If those disagree, the ladder filter is selecting the wrong rows — but note both the mod and
the tooltip now read the same table with the same filter, so a disagreement means one of them
is not seeing the campaign config it expects.

## Known limitations, by design

- **No score rate on first open.** Score-per-turn is not exposed by any API, so the mod
  samples it once per turn. Until 2 samples exist it holds scores flat and says so in the
  footer. That is honest rather than wrong — a flat forecast still exactly answers "would the
  lower threshold already be satisfied by current standings?" — but the first screen you see
  is the least informative one. Play 2+ turns before judging the projection.
- **History is session-only.** It resets on reload; nothing is persisted.
- **Linear projection.** Two-point rate over a rolling 12-turn window. No curve fitting, no
  awareness of what actually generates each score type.
- **Summary tab only.** The per-victory detail tabs are not augmented.

## Next steps, in priority order

1. Re-test with `MIN_SPAN_TURNS` in place: play past turn 5-10 and check the projection is
   sane once a real baseline exists. This is the open question.
2. Replace the two-point rate with a least-squares fit over the 12-turn window. Two points is
   noise-sensitive even with a 5-turn span, and the data is lumpy by nature.
3. Consider whether linear extrapolation is defensible at all for a 19-30 turn horizon off a
   12-turn window. It may be more honest to project only as far as the window is long, and
   say "not enough history" beyond that.
4. Only then consider Phase 2 (badges on individual player rows). Those rows are SolidJS
   managed and will be re-rendered underneath any injected node, so they need a different
   approach from the append-a-block strategy used for the cards.

## Repo note

An earlier session's git proxy lost push credentials and pushed via the GitHub API instead.
If a future session hits `could not read Username for 'https://github.com'`, that is the same
problem — fetch works, push does not.
