# Handoff — state, confidence, and next steps

Written at the end of the rewrite session. Read this before touching the code.

## Where things stand

The mod is **written and pushed but has never been run**. It was developed in a cloud
container with no Civilization VII installation, so everything below is verified against
*source and syntax*, never against a running game.

- `ui/victory-forecaster/victory-forecaster.js` — the entire mod, ~500 lines, single file
- `civ7-tot-victory-forecaster.modinfo` — manifest
- JS passes `node --check`; all XML parses

Nothing has been validated at runtime. Treat the first launch as a smoke test, not a demo.

## Where the research came from

All game-internals research came from the GitHub mirror
[`mateicanavra/civ7-official-resources`](https://github.com/mateicanavra/civ7-official-resources),
**not** from a local installation.

That matters: the mirror may lag your installed build, and it is base-standard only — it does
**not** include ToT DLC modules that could override `VictoryDominationPercents` rows or
restyle the victories screen. Validating against your real install is the single most
valuable thing the next session can do.

## Confidence table

| Claim | Status | Evidence |
|---|---|---|
| Tier ladder lives in `<VictoryDominationPercents>` in `data/victories.xml` | CONFIRMED | Read the raw XML directly |
| `multiplier = (DominationPercent + 100) / 100` | CONFIRMED | `calcTooltipForVictory` in `victories-screen-model.js` |
| Modern ladder 4.0×@0 / 3.0×@20 / 2.0×@40 / 1.5×@60 / 1.25×@80 | CONFIRMED | XML rows, `StartingAge=AGE_ANTIQUITY`, `PreviousAgeCount=2` |
| Momentous = 2× before 60%, Substantive = 1.5× before 80% | CONFIRMED | Matches the user's in-game tooltip screenshot exactly |
| Point Goal = multiplier × 2nd place score | CONFIRMED | Screenshot arithmetic: 612=2×306, 182=2×91, 12820=2×6410 |
| Science = flat 100 Innovation, no ladder | CONFIRMED | No science rows in the table; Civilopedia text |
| 5-turn countdown, pauses (not resets) on falling below | CONFIRMED | Civilopedia + AdvisorText |
| `Game.AgeProgressManager.getCurrentAgeProgressionPoints()` / `getMaxAgeProgressionPoints()` | CONFIRMED | Called in `victories-screen-model.js` |
| `Game.VictoryManager.getCountdownVictoryDominanceScore(hash)` | CONFIRMED | Called in `victories-screen-model.js:533` |
| `UIScripts` (not `ImportFiles`) loads a *new* UI script | LIKELY | Community modding docs; not tested |
| `player.Victories.getPointsForVictoryType(hash)` | INFERRED | Read from call sites; no type declarations exist |
| `Players.getAliveMajors()` | GUESSED | Has a `getAlive().filter(isMajor)` fallback in code |
| `player.name` yields a usable leader label | GUESSED | Falls back through `leaderName`, `civilizationFullName` |
| Card selectors `[data-name="SummaryVictoryCard"]` / `.victories-summary-box` | LIKELY | From compiled SolidJS `template()` strings in the mirror |
| Per-type classes `victories-summary-{cultural,…}` | LIKELY | Same source |
| `engine.on('VictoryThresholdChanged', …)` fires in UI context | INFERRED | Model uses `createEngineEvent("VictoryThresholdChanged")` |
| ui-next screen actually overrides the older `ui/victory-progress/` one | UNCERTAIN | Both are listed in `base-standard.modinfo`; override semantics not traced |

Anything marked GUESSED / INFERRED / UNCERTAIN is a candidate root cause if the mod
misbehaves. The code is defensive around all of them (every access is wrapped and falls
back), so the expected failure mode is "block renders with wrong or missing numbers", not
"game crashes".

## Step 1 — validate against the local install

Locate the real game files first. On macOS the Steam install is usually under
`~/Library/Application Support/Steam/steamapps/common/`, but do not assume — find it:

```bash
# Find the shipped victories data file(s), including any DLC copies
find ~/Library/Application\ Support/Steam/steamapps/common \
     -name 'victories*.xml' -path '*base-standard*' 2>/dev/null

# Broader sweep if that misses (covers DLC / ToT modules)
find ~/Library/Application\ Support/Steam/steamapps/common \
     -name 'victories*.xml' 2>/dev/null
```

Then check the three things that would invalidate the forecast:

```bash
VX="<path to the victories.xml found above>"

# 1. Does the local ladder match the README table?
grep -A2 'VictoryDominationPercents' "$VX" | head -60

# 2. Does any DLC/ToT module ALSO define these rows (an override the mirror lacks)?
find ~/Library/Application\ Support/Steam/steamapps/common \
     -name '*.xml' -exec grep -l 'VictoryDominationPercents' {} \; 2>/dev/null

# 3. Do the UI selectors the mod keys on actually exist in the installed build?
grep -rho 'victories-summary-[a-z]*'  <civ7 ui-next dir> | sort -u
grep -rho 'SummaryVictoryCard'        <civ7 ui-next dir> | head
```

If (2) returns a DLC file with its own rows, the mod still handles it correctly — it reads
`GameInfo.VictoryDominationPercents` at runtime, which is the merged database. But the
README's documentation table would need updating.

If (3) returns nothing, the selectors are wrong for this build and injection will silently
no-op. That is the most likely single point of failure.

## Step 2 — install and read the diagnostics

```bash
./scripts/install.sh     # symlinks the repo into Mods/ and clears Mods.sqlite
./scripts/view_logs.sh   # leave running in a second terminal
```

Enable **ToT Victory Forecaster [Local Dev]** in Additional Content, restart Civ7, load a
Modern-age save, open the Victories screen.

The mod emits a one-shot diagnostics line at startup:

```
[TOT-VF] diagnostics {"agePct":47,"turn":34,"age":"AGE_MODERN","prevAgeCount":2,
  "summary":[{"type":"VICTORY_CULTURE_MODERN","goal":612,
              "tiers":["0%:x4","20%:x3","40%:x2","60%:x1.5","80%:x1.25"],
              "top":["Sayyida al Hurra=514","Pachacuti=306"]}, …]}
```

Read it as a checklist:

| Field | If it is wrong |
|---|---|
| `agePct` null | `AgeProgressManager` method names differ in this build |
| `prevAgeCount` not 2 (Antiquity-start game) | Ladder filter will select the wrong row set |
| `tiers` empty | The `GameInfo.VictoryDominationPercents` filter matched nothing — check `campaignStartAgeType` |
| `goal` is -1 | Victory locked, or `getCountdownVictoryDominanceScore` signature differs |
| `top` empty or all zero | `player.Victories.getPointsForVictoryType` is wrong — the INFERRED item most likely to break |
| `top` names look like `Player 3` | `playerLabel` fallbacks all missed; find the right property |

Also expect a `[TOT-VF] refresh {"reason":…,"cards":4,"injected":4}` line each time the
screen opens. **`cards: 0` means the selectors are wrong** — that is the failure to chase
first, and Step 1 item (3) is how to fix it.

If you see no `[TOT-VF]` output whatsoever, the script never loaded: suspect the `UIScripts`
manifest action (marked LIKELY above, not confirmed) before suspecting the code.

## Step 3 — cross-check one number by hand

The mod's arithmetic is only trustworthy if it agrees with the game's own tooltip. Hover a
victory card to open **Victory Tier Information** and confirm:

- the tooltip's `Next: <tier>` name matches the mod's second forecast row
- the tooltip's `Required: Nx … before P% Age Progress` multiplier and percentage match

If those disagree, the ladder filter (`campaignStartAgeType` + `previousAgeCount`) is
selecting the wrong rows.

## Known limitations, by design

- **No score rate on first open.** Score-per-turn is not exposed by any API, so the mod
  samples it once per turn. Until 2 samples exist it holds scores flat and says so in the
  footer. This is honest rather than wrong — a flat forecast still exactly answers "would the
  lower threshold already be satisfied by current standings?" — but it means the first screen
  you see is the least informative one. Play 2+ turns before judging the projection.
- **History is session-only.** It resets on reload; nothing is persisted.
- **Linear projection.** Two-point rate over a rolling 12-turn window. No curve fitting, no
  awareness of what actually generates each score type.
- **Countdown state is ignored.** The mod does not read `getVictoryCountdownStatus`, so it
  will not tell you a countdown is already running or paused. That is Phase 3.
- **Summary tab only.** The per-victory detail tabs are not augmented.

## Next steps, in priority order

1. Run Step 1 and Step 2 above. Fix selectors / API names based on the diagnostics line.
   Nothing else is worth doing until `cards: 4` and `top` shows real names and scores.
2. Once numbers are trustworthy, reconsider the projection. Two-point linear rate is crude;
   if scores are noisy, a least-squares fit over the window would be better.
3. Add countdown awareness via `player.Victories.getVictoryCountdownStatus(hash)` — showing
   "countdown running, 3/5 turns" is more actionable than a projection once someone is
   actually in the countdown.
4. Only then consider Phase 2 (badges on individual player rows). Those rows are SolidJS
   managed and will be re-rendered underneath any injected node, so they need a different
   approach from the append-a-block strategy used for the cards.

## Repo note

The session's git proxy lost push credentials partway through, so the final commits were
pushed via the GitHub API rather than `git push`. Content was verified byte-identical (tree
hash matched on both sides). Anonymous `git fetch` still worked. If a future session hits
`could not read Username for 'https://github.com'`, that is the same problem — fetch works,
push does not, and the GitHub MCP `push_files` tool is the workaround.
