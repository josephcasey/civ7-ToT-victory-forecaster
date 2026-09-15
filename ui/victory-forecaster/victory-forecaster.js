// Civ7 Test of Time — Victory Forecaster
//
// Augments the in-game VICTORIES screen with a forecast strip inside each victory card,
// flagging which civ is projected to cross the threshold when the Point Goal next drops.
//
// No button, no user interaction. Install the mod and the screen gains the extra rows.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// HOW VICTORY ACTUALLY WORKS  (verified against the INSTALLED 1.4.0 build, not a mirror)
//
// base-standard/data/victories.xml declares <VictoryDominationPercents>:
//     <Row VictoryType="VICTORY_CULTURE_MODERN" Name="LOC_VICTORY_NAME_4"
//          StartingAge="AGE_ANTIQUITY" MinAgeProgressPercent="40"
//          DominationPercent="100" PreviousAgeCount="2"/>
//
// The required lead over 2nd place is  mult = (DominationPercent + 100) / 100,  and it steps
// DOWN as age progress (a PERCENTAGE, not raw points) rises. Standard Antiquity-start
// campaign, Modern age (previousAgeCount = 2):
//
//     age >=  0%   4.00x   Crushing Victory      (LOC_VICTORY_NAME_2)
//     age >= 20%   3.00x   Decisive Victory      (LOC_VICTORY_NAME_3)
//     age >= 40%   2.00x   Momentous Victory     (LOC_VICTORY_NAME_4)
//     age >= 60%   1.50x   Substantive Victory   (LOC_VICTORY_NAME_5)
//     age >= 80%   1.25x   Narrow Victory        (LOC_VICTORY_NAME_6)
//
// We never hardcode that ladder — it is read live from GameInfo.VictoryDominationPercents
// with the same filter the game's own tooltip uses (calcTooltipForVictory in
// ui-next/screens/victories/victories-screen-model.js). The table above is documentation
// only, so a DLC or rules mod that edits those rows is picked up automatically.
//
// Science is NOT a domination victory. GameInfo.VictoryTypes gives it
// ScoringType="COUNTDOWN_VICTORY_SCORING_TYPE_FIXED_SCORE" MinimumPoints="100" — a flat race
// to 100, read from data here rather than assumed.
//
// Reaching a threshold starts a CountdownDuration-turn countdown (5 in the shipped data).
// Dropping back below PAUSES it (progress saved, not reset) — either by losing points, or by
// 2nd place gaining enough to push the goal up.
//
// ─── WHAT THIS MOD DRAWS ─────────────────────────────────────────────────────────────────
// Nothing of its own. It augments the stock Victories screen in two places:
//
//   1. The leaderboard score of any civ that ALREADY clears the goal the next tier will set
//      turns red — that civ starts a victory countdown the moment the Point Goal drops.
//      Only the leader can ever qualify: the goal is a multiple (>1) of SECOND place, so no
//      one below first can clear it.
//   2. The card's hover tooltip gains, in each victory-tier section, the actual Point Goal
//      that tier produces and the arithmetic behind it, plus a callout naming the civ whose
//      countdown that tier would start.
//
// Every figure is exact arithmetic over CURRENT standings. There is no projection anywhere:
// the Point Goal falls because the MULTIPLIER drops, not because scores move.
//
// ─── WHERE THE DOM FACTS COME FROM ───────────────────────────────────────────────────────
// summary-victory-tab.js renders each card as an Activatable (a plain <div>) carrying
//     data-name="SummaryVictoryCard"  class="victories-summary-box …"
// Its FIRST child is the background layer:
//     class="victories-summary-bg … ${props.summaryBg}"
// and props.summaryBg is where victories-summary-{military,cultural,economic,scientific}
// actually lives (victories-screen-model.js, populateData). Those per-type classes are NOT
// on the card itself — reading them off the card is the bug this file previously had.
// ─────────────────────────────────────────────────────────────────────────────────────────

const VF_TAG         = '[TOT-VF]';

const CARD_SELECTOR = '[data-name="SummaryVictoryCard"], .victories-summary-box';
const BG_CLASS      = 'victories-summary-bg';

// VictoryClassType -> the summaryBg class the model stamps on the card's background layer.
// Mirrors the switch in victories-screen-model.js populateData().
const CLASS_TO_BG = {
  VICTORY_CLASS_MILITARY: 'victories-summary-military',
  VICTORY_CLASS_CULTURE:  'victories-summary-cultural',
  VICTORY_CLASS_ECONOMIC: 'victories-summary-economic',
  VICTORY_CLASS_SCIENCE:  'victories-summary-scientific',
};

// GameInfo.VictoryTypes.ScoringType. The other shipped value is
// COUNTDOWN_VICTORY_SCORING_TYPE_DOMINATION (culture/economic/military), which is the
// default branch here.
const SCORING_FIXED_SCORE = 'COUNTDOWN_VICTORY_SCORING_TYPE_FIXED_SCORE';

// Marks every node this mod adds, so the MutationObserver can ignore its own work and so
// re-augmenting a tooltip is idempotent.
const VF_MARK   = 'vf-aug';
const HOT_ATTR  = 'data-vf-hot';

// VictoryClassType -> the longform blurb the base tooltip prints. Used to work out WHICH
// victory a portalled tooltip belongs to; the four strings are distinct.
const CLASS_TO_DESC = {
  VICTORY_CLASS_MILITARY: 'LOC_VICTORY_MILITARY_LONGFORM',
  VICTORY_CLASS_CULTURE:  'LOC_VICTORY_CULTURAL_LONGFORM',
  VICTORY_CLASS_ECONOMIC: 'LOC_VICTORY_ECONOMIC_LONGFORM',
  VICTORY_CLASS_SCIENCE:  'LOC_VICTORY_SCIENTIFIC_LONGFORM',
};

function vfLog(msg, data) {
  try {
    console.error(VF_TAG, msg, data !== undefined ? JSON.stringify(data) : '');
  } catch { /* logging must never throw into the game UI */ }
}

// ── VICTORY CATALOGUE ────────────────────────────────────────────────────────────────────
//
// Built from the live database rather than a hardcoded list, so renamed or DLC-added
// victories are handled. GameInfo.VictoryTypes carries scoring rules and $hash;
// GameInfo.Victories carries VictoryClassType. The screen model joins the same two tables.

let catalogue = null;

function buildCatalogue() {
  const out = [];
  try {
    GameInfo.VictoryTypes.forEach(vt => {
      let def = null;
      try { def = GameInfo.Victories.find(v => v.VictoryType === vt.VictoryType); } catch { }
      const bg = def ? CLASS_TO_BG[def.VictoryClassType] : undefined;
      if (!bg) return;   // score/domination-classic victories have no summary card

      let hash = vt.$hash;
      if (hash == null) {
        try { hash = Database.makeHash(vt.VictoryType); } catch { }
      }
      if (hash == null) return;

      out.push({
        type:      vt.VictoryType,
        hash,
        classType: def.VictoryClassType,
        bgClass:   bg,
        scoring:   vt.ScoringType,
        fixedGoal: Number(vt.MinimumPoints) || 0,
        countdown: Number(vt.CountdownDuration) || 0,
      });
    });
  } catch (e) {
    vfLog('buildCatalogue failed', String(e));
  }
  return out;
}

function victories() {
  if (!catalogue || !catalogue.length) catalogue = buildCatalogue();
  return catalogue;
}

function isFixedScore(v) { return v.scoring === SCORING_FIXED_SCORE; }

// Diagnostics only. The game calls this with both a type string (populateData) and a hash
// (victories-screen.js), so both forms are tried. It is deliberately NOT used to gate
// injection: a card only exists in the DOM when the victory is already enabled, so gating on
// it could only ever produce false negatives.
function victoryEnabled(v) {
  for (const arg of [v.type, v.hash]) {
    try {
      const r = Game.VictoryManager.isCountdownVictoryEnabled(arg);
      if (typeof r === 'boolean') return r;
    } catch { }
  }
  return null;
}

// ── GAME DATA ────────────────────────────────────────────────────────────────────────────

// Age progress as a percentage. Exactly how victories-screen-model.js computes it.
function ageProgressPct() {
  try {
    const cur = Game.AgeProgressManager.getCurrentAgeProgressionPoints();
    const max = Game.AgeProgressManager.getMaxAgeProgressionPoints();
    if (!max || max <= 0) return null;
    return (cur / max) * 100;
  } catch {
    return null;
  }
}

// "One more turn" / extended games have no age timer, so no tier ladder can advance.
function isExtendedGame() {
  try {
    return Game.AgeProgressManager.isExtendedGame ||
           Game.AgeProgressManager.getMaxAgeProgressionPoints() <= 0;
  } catch {
    return false;
  }
}

// The tier ladder for one victory type, ASCENDING by MinAgeProgressPercent.
// Filter matches calcTooltipForVictory: campaign START age + ages elapsed since.
function tierLadder(victoryTypeString) {
  const rows = [];
  try {
    const cfg          = Configuration.getGame();
    const startAgeType = GameInfo.Ages.lookup(cfg.campaignStartAgeType)?.AgeType;
    const prevAges     = cfg.previousAgeCount;
    GameInfo.VictoryDominationPercents.forEach(row => {
      if (row.VictoryType === victoryTypeString &&
          row.StartingAge === startAgeType &&
          row.PreviousAgeCount === prevAges) {
        rows.push({
          nameKey:    row.Name,
          minAgePct:  Number(row.MinAgeProgressPercent),
          multiplier: (Number(row.DominationPercent) + 100) / 100,
        });
      }
    });
  } catch (e) {
    vfLog('tierLadder failed', String(e));
  }
  rows.sort((a, b) => a.minAgePct - b.minAgePct);
  return rows;
}

// Split the ladder into the tier in force now and the tiers still to come.
function splitTiers(ladder, agePct) {
  let current = null;
  const upcoming = [];
  for (const tier of ladder) {
    if (agePct >= tier.minAgePct) current = tier;
    else upcoming.push(tier);
  }
  return { current, upcoming };
}

function localize(key, fallback) {
  try {
    const s = Locale.compose(key);
    if (s && s !== key) return s;
  } catch { }
  return fallback ?? key;
}

// Players.getAliveMajors() does NOT exist in this build. The game itself filters
// Players.getAlive() by isMajor && Victories (calcVictoryLeaderboard).
function majorPlayers() {
  try {
    return (Players.getAlive?.() ?? []).filter(p => p && p.isMajor && p.Victories);
  } catch {
    return [];
  }
}

// The screen anonymises civs the local player has not met (LOC_UI_UNMET_PLAYER_NAME).
// Mirror that rather than leaking names the base UI deliberately withholds.
function metChecker() {
  try {
    const local = Players.get(GameContext.localPlayerID);
    const diplo = local?.Diplomacy;
    if (!diplo) return () => true;
    return (id) => id === GameContext.localPlayerID || diplo.hasMet(id);
  } catch {
    return () => true;
  }
}

function playerLabel(player, hasMet) {
  if (!hasMet) return localize('LOC_UI_UNMET_PLAYER_NAME', 'Unmet civ');
  const raw = player?.leaderName ?? player?.name ?? player?.civilizationFullName ?? '';
  const name = localize(raw, String(raw || ''));
  return name || `Player ${player?.id ?? '?'}`;
}

// Current standings for one victory, highest score first.
function leaderboard(v) {
  const rows = [];
  const hasMet = metChecker();
  let localId = -1;
  try { localId = GameContext.localPlayerID; } catch { }

  for (const player of majorPlayers()) {
    let pts = 0;
    try { pts = Number(player.Victories.getPointsForVictoryType(v.hash)) || 0; } catch { }

    let turns = 0, dominant = false;
    try {
      const status = player.Victories.getVictoryCountdownStatus(v.hash);
      if (status) {
        turns    = Number(status.turns) || 0;
        dominant = !!status.isDominant;
      }
    } catch { }

    const met = hasMet(player.id);
    rows.push({
      id: player.id,
      name: playerLabel(player, met),
      points: pts,
      isLocal: player.id === localId,
      turns,
      dominant,
    });
  }
  rows.sort((a, b) => b.points - a.points);
  return rows;
}

// The authoritative Point Goal the screen itself renders (-1 when the victory is locked).
function pointGoal(v) {
  try { return Number(Game.VictoryManager.getCountdownVictoryDominanceScore(v.hash)); }
  catch { return -1; }
}

// MinimumPoints from the database (100 for science in the shipped data); the live manager
// value wins when it reports a real goal.
function fixedGoalFor(v) {
  const live = pointGoal(v);
  if (live > 0) return live;
  return v.fixedGoal > 0 ? v.fixedGoal : 100;
}

// ── THRESHOLD ASSESSMENT ─────────────────────────────────────────────────────────────────
//
// The whole mod reduces to one calculation, done entirely on current scores:
//     goal(tier) = tier.multiplier x SECOND PLACE's current score
// and the question "does the leader already clear the goal the NEXT tier will set?".

function assess(v) {
  const board = leaderboard(v);
  if (board.length < 2) return null;

  const leader = board[0];
  const second = board[1];
  const liveGoal = pointGoal(v);

  if (isFixedScore(v)) {
    const goal = fixedGoalFor(v);
    return {
      v, board, leader, second, fixed: true,
      currentGoal: goal, nextGoal: null, triggerGoal: goal,
      triggers: goal > 0 && leader.points >= goal,
      nowClears: goal > 0 && leader.points >= goal,
      current: null, next: null, liveGoal,
    };
  }

  const ladder = tierLadder(v.type);
  const { current, upcoming } = splitTiers(ladder, ageProgressPct() ?? 0);
  const next = upcoming[0] ?? null;

  // Prefer the game's own Point Goal for the tier in force — it is authoritative, and if it
  // disagrees with our arithmetic the diagnostics line will show it.
  const derivedNow  = current ? second.points * current.multiplier : null;
  const currentGoal = liveGoal > 0 ? liveGoal : derivedNow;
  const nextGoal    = next ? second.points * next.multiplier : null;

  // What decides "imminent": the next reduction if one is coming, else the goal in force.
  const triggerGoal = nextGoal != null ? nextGoal : currentGoal;

  return {
    v, board, leader, second, fixed: false, ladder, current, next,
    currentGoal, derivedNow, nextGoal, triggerGoal, liveGoal,
    triggers:  triggerGoal != null && triggerGoal > 0 && leader.points >= triggerGoal,
    nowClears: currentGoal != null && currentGoal > 0 && leader.points >= currentGoal,
  };
}

// ── SHARED RENDERING ─────────────────────────────────────────────────────────────────────

const STYLE_ID = 'vf-forecast-style';

function ensureStyles() {
  try {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.vf-tip { margin: 0.25rem 0.6rem 0.5rem; text-align: center; }
.vf-tip-calc {
  color: #c9a227;
  font-size: 0.62rem;
  line-height: 1.45;
  opacity: 0.95;
}
.vf-tip-verdict { font-size: 0.66rem; line-height: 1.5; margin-top: 0.1rem; }
.vf-tip-hot  { color: #ff6b6b; }
.vf-tip-cool { color: #b9c2d0; }
.vf-tip-rule {
  height: 1px;
  margin: 0.3rem 1.2rem 0.35rem;
  background: rgba(201, 162, 39, 0.3);
}
`;
    document.head.appendChild(style);
  } catch (e) {
    vfLog('ensureStyles failed', String(e));
  }
}

function fmt(n) {
  if (n == null || !isFinite(n)) return '—';
  const r = Math.round(n);
  try { return Locale.toNumber(r); } catch { }
  try { return r.toLocaleString(); } catch { return String(r); }
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

// ── 1. RED SCORE ON THE LEADERBOARD ──────────────────────────────────────────────────────
//
// PointGoalPanel renders each leaderboard row's score as a div carrying `font-body text-2xs
// self-center mr-2`. The portrait wrapper shares `mr-2 self-center` but has no `text-2xs`,
// and the name field has `text-2xs` but also `victories-name-field` - so the pair of classes
// minus the name field picks out exactly the score cells, in leaderboard order.
//
// Colour goes on inline style, not className: the base component owns className through a
// createRenderEffect and would wipe a class of ours on its next run.
function scoreCells(card) {
  const out = [];
  try {
    const panel = card.querySelector('[data-name="Point-Goal-Panel"]');
    if (!panel) return out;
    panel.querySelectorAll('div').forEach(d => {
      const c = typeof d.className === 'string' ? d.className : '';
      if (c.indexOf('victories-name-field') !== -1) return;
      if (c.indexOf('text-2xs') !== -1 && c.indexOf('mr-2') !== -1) out.push(d);
    });
  } catch (e) {
    vfLog('scoreCells failed', String(e));
  }
  return out;
}

function paintScores(card, a) {
  const cells = scoreCells(card);
  if (!cells.length) return 0;
  let painted = 0;

  cells.forEach((cell, i) => {
    // Only the leader can clear a goal defined as (>1) x second place.
    const hot = !!(a && a.triggers && i === 0);
    try {
      if (hot) {
        cell.style.setProperty('color', '#ff5a5a');
        cell.style.setProperty('opacity', '1');
        cell.setAttribute(HOT_ATTR, '1');
        painted++;
      } else if (cell.getAttribute && cell.getAttribute(HOT_ATTR)) {
        cell.style.removeProperty('color');
        cell.style.removeProperty('opacity');
        cell.removeAttribute(HOT_ATTR);
      }
    } catch { /* styling must never throw into the game UI */ }
  });

  return painted;
}

// ── 2. TOOLTIP AUGMENTATION ──────────────────────────────────────────────────────────────
//
// Tooltips are portalled into #uinext-tooltips (tooltip.js:237). The victory card's tooltip
// carries `victories-tooltip`, and its body is a stack of CardFrames (`data-name="Card-Frame"`):
// [Required Points] [tier in force] [next tier]. The last two are conditional - a locked
// victory renders neither, and science has no tier rows at all.

const TOOLTIP_SELECTOR = '.tooltip-content-root.victories-tooltip, .victories-tooltip';

// Identify the victory from the longform blurb the tooltip prints. Stateless, so it does not
// care whether the tooltip was opened by mouse, keyboard or controller.
function victoryFromTooltip(node) {
  const text = node.textContent || '';
  if (!text) return null;
  for (const v of victories()) {
    const key = CLASS_TO_DESC[v.classType];
    if (!key) continue;
    const desc = localize(key, '');
    if (desc && desc.length > 24 && text.indexOf(desc.slice(0, 40)) !== -1) return v;
  }
  return null;
}

function tierFrame(frames, tierName) {
  if (!tierName) return null;
  // frames[0] is the "Required Points" blurb; tier sections start after it.
  for (let i = 1; i < frames.length; i++) {
    if ((frames[i].textContent || '').indexOf(tierName) !== -1) return frames[i];
  }
  return null;
}

// The lines appended inside one tier's section: the goal that tier yields, the arithmetic
// behind it, and what it means for the leader.
function tierDetail(a, mult, goal, isTrigger, whenPct) {
  const wrap = el('div', `${VF_MARK} vf-tip`);
  wrap.appendChild(el('div', 'vf-tip-rule'));

  wrap.appendChild(el('div', 'vf-tip-calc',
    `Point Goal ${fmt(goal)}  =  ×${mult} of 2nd place (${a.second.name} ${fmt(a.second.points)})`));

  const clears = goal > 0 && a.leader.points >= goal;
  const gap    = Math.abs(a.leader.points - goal);

  if (clears && isTrigger) {
    wrap.appendChild(el('div', 'vf-tip-verdict vf-tip-hot',
      whenPct != null
        ? `⚠ ${a.leader.name} (${fmt(a.leader.points)}) already clears this — countdown starts at ${whenPct}% Age Progress`
        : `⚠ ${a.leader.name} (${fmt(a.leader.points)}) already clears this — countdown running`));
  } else if (clears) {
    wrap.appendChild(el('div', 'vf-tip-verdict vf-tip-hot',
      `⚠ ${a.leader.name} (${fmt(a.leader.points)}) clears this by ${fmt(gap)}`));
  } else {
    wrap.appendChild(el('div', 'vf-tip-verdict vf-tip-cool',
      `${a.leader.name} leads on ${fmt(a.leader.points)} — ${fmt(gap)} short`));
  }

  return wrap;
}

function augmentTooltip(root) {
  // Idempotent: the observer sees our own inserts too.
  if (root.querySelector(`.${VF_MARK}`)) return 'done';

  const v = victoryFromTooltip(root);
  if (!v) return 'unmatched';
  const a = assess(v);
  if (!a) return 'nodata';

  const frames = Array.from(root.querySelectorAll('[data-name="Card-Frame"]'));
  if (!frames.length) return 'noframes';

  if (a.fixed) {
    // No tier ladder: one fixed goal, so the blurb section carries the numbers.
    const wrap = el('div', `${VF_MARK} vf-tip`);
    wrap.appendChild(el('div', 'vf-tip-rule'));
    wrap.appendChild(el('div', 'vf-tip-calc', `Point Goal ${fmt(a.currentGoal)} — fixed, not a multiple of 2nd place`));
    const clears = a.currentGoal > 0 && a.leader.points >= a.currentGoal;
    wrap.appendChild(el('div', `vf-tip-verdict ${clears ? 'vf-tip-hot' : 'vf-tip-cool'}`,
      clears
        ? `⚠ ${a.leader.name} (${fmt(a.leader.points)}) has reached it — countdown imminent`
        : `${a.leader.name} leads on ${fmt(a.leader.points)} — ${fmt(a.currentGoal - a.leader.points)} short`));
    frames[0].appendChild(wrap);
    return 'ok';
  }

  let placed = 0;

  // Section for the tier in force now.
  if (a.current && a.currentGoal != null) {
    const f = tierFrame(frames, localize(a.current.nameKey, ''));
    if (f) {
      // Imminence is decided by the NEXT tier when one exists, so the "in force" section only
      // raises the alarm itself when it is the last tier there is.
      f.appendChild(tierDetail(a, a.current.multiplier, a.currentGoal, a.next == null, null));
      placed++;
    }
  }

  // Section for the next reduction — the one that actually starts a countdown.
  if (a.next && a.nextGoal != null) {
    const f = tierFrame(frames, localize(a.next.nameKey, ''));
    if (f) {
      f.appendChild(tierDetail(a, a.next.multiplier, a.nextGoal, true, a.next.minAgePct));
      placed++;
    }
  }

  // Locked victory: the base tooltip renders no tier sections at all, so state what is coming.
  if (!placed) {
    const tier = a.next ?? a.current;
    if (!tier) return 'notiers';
    const goal = a.second.points * tier.multiplier;
    const wrap = tierDetail(a, tier.multiplier, goal, true, tier.minAgePct);
    wrap.insertBefore(
      el('div', 'vf-tip-calc', `Locked until ${tier.minAgePct}% Age Progress — no Point Goal yet`),
      wrap.children[1] ?? null);
    frames[0].appendChild(wrap);
    placed++;
  }

  return placed ? 'ok' : 'noplace';
}

// ── SWEEP ────────────────────────────────────────────────────────────────────────────────

function findCards() {
  const found = [];
  try {
    document.querySelectorAll(CARD_SELECTOR).forEach(node => {
      if (found.indexOf(node) === -1) found.push(node);
    });
  } catch (e) {
    vfLog('findCards failed', String(e));
  }
  return found;
}

// The per-type class lives on the card's background layer, not on the card.
function bgClassesOf(card) {
  const classes = [];
  const collect = (node) => {
    if (node?.classList?.contains(BG_CLASS)) {
      for (const c of Array.from(node.classList)) classes.push(c);
    }
  };
  try { card.querySelectorAll?.('.' + BG_CLASS).forEach(collect); } catch { }
  if (!classes.length) {
    for (const child of Array.from(card.children || [])) collect(child);
  }
  return classes;
}

function victoryForCard(card) {
  const classes = bgClassesOf(card);
  if (!classes.length) return null;
  for (const v of victories()) {
    if (classes.indexOf(v.bgClass) !== -1) return v;
  }
  return null;
}

function refreshAll(reason) {
  const tally = {};
  const bump  = k => { tally[k] = (tally[k] || 0) + 1; };

  const cards = findCards();
  for (const card of cards) {
    try {
      const v = victoryForCard(card);
      if (!v) { bump('unmatched'); continue; }
      const a = assess(v);
      if (!a) { bump('nodata'); continue; }
      bump(paintScores(card, a) ? 'hot' : 'cool');
    } catch (e) {
      bump('error');
      vfLog('card sweep failed', String(e));
    }
  }

  let tips = 0;
  try {
    document.querySelectorAll(TOOLTIP_SELECTOR).forEach(node => {
      const r = augmentTooltip(node);
      if (r === 'ok') tips++;
      else if (r !== 'done') bump(`tip:${r}`);
    });
  } catch (e) {
    vfLog('tooltip sweep failed', String(e));
  }

  if (cards.length || tips) vfLog('refresh', { reason, cards: cards.length, tips, ...tally });
  return cards.length;
}

// ── CONTROLLER ───────────────────────────────────────────────────────────────────────────

class VictoryForecaster {
  static instance = null;

  static start() {
    if (!VictoryForecaster.instance) VictoryForecaster.instance = new VictoryForecaster();
    return VictoryForecaster.instance;
  }

  constructor() {
    this._pending = null;
    ensureStyles();
    this._observe();
    this._listen();
    this._diagnostics();
    this._schedule('init');
  }

  // Cards are re-created on tab switch and tooltips are portalled in on hover, so watch the
  // whole document rather than binding to one panel instance.
  _observe() {
    try {
      this._observer = new MutationObserver(mutations => {
        for (const mut of mutations) {
          for (const node of mut.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.classList?.contains(VF_MARK)) continue;   // our own insert
            if (node.closest?.(`.${VF_MARK}`)) continue;
            if (node.matches?.(CARD_SELECTOR) || node.querySelector?.(CARD_SELECTOR) ||
                node.matches?.(TOOLTIP_SELECTOR) || node.querySelector?.(TOOLTIP_SELECTOR)) {
              this._schedule('dom');
              return;
            }
          }
        }
      });
      this._observer.observe(document.body, { childList: true, subtree: true });
    } catch (e) {
      vfLog('observer failed', String(e));
    }
  }

  _listen() {
    const on = (evt, fn) => {
      try { engine.on(evt, fn); } catch { /* event not present in this build */ }
    };
    const again = (reason) => () => this._schedule(reason);
    on('PlayerTurnActivated',     again('turn'));
    on('TurnBegin',               again('turn'));
    on('VictoryPointsChanged',    again('points'));
    on('VictoryDominanceChanged', again('dominance'));
    on('VictoryCountdownChanged', again('countdown'));
    on('VictoryThresholdChanged', again('threshold'));
  }

  _schedule(reason) {
    if (this._pending) return;
    this._pending = true;
    const run = () => {
      this._pending = null;
      try { refreshAll(reason); } catch (e) { vfLog('refresh failed', String(e)); }
    };
    try { requestAnimationFrame(() => setTimeout(run, 30)); } catch { setTimeout(run, 50); }
  }

  _diagnostics() {
    try {
      const agePct = ageProgressPct();
      const summary = victories().map(v => {
        const a = assess(v);
        return {
          type: v.type,
          goal: pointGoal(v),
          // Our arithmetic vs the game's own Point Goal. A mismatch means the model is wrong.
          derived: a && !a.fixed ? (a.derivedNow ?? null) : (a ? a.currentGoal : null),
          next: a ? a.nextGoal : null,
          triggers: a ? a.triggers : null,
          tiers: tierLadder(v.type).map(t => `${t.minAgePct}%:x${t.multiplier}`),
          top: a ? a.board.slice(0, 2).map(b => `${b.name}=${b.points}`) : [],
        };
      });
      vfLog('diagnostics', {
        agePct: agePct != null ? Math.round(agePct) : null,
        extended: isExtendedGame(),
        turn: (() => { try { return Game.turn; } catch { return null; } })(),
        age: (() => { try { return GameInfo.Ages.lookup(Game.age)?.AgeType; } catch { return null; } })(),
        startAge: (() => { try { return GameInfo.Ages.lookup(Configuration.getGame().campaignStartAgeType)?.AgeType; } catch { return null; } })(),
        prevAgeCount: (() => { try { return Configuration.getGame().previousAgeCount; } catch { return null; } })(),
        majors: majorPlayers().length,
        summary,
      });
    } catch (e) {
      vfLog('diagnostics failed', String(e));
    }
  }
}

engine.whenReady.then(() => {
  try {
    VictoryForecaster.start();
    vfLog('ready');
  } catch (e) {
    vfLog('startup failed', String(e));
  }
});
