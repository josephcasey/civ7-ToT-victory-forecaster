// Civ7 Test of Time — Victory Forecaster
//
// Augments the in-game VICTORIES screen (screen-victory-progress) with a forecast strip
// under each victory card, flagging which civ is projected to cross the threshold when the
// victory Point Goal next drops.
//
// No button, no user interaction. Install the mod and the screen gains the extra rows.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// HOW ToT VICTORY ACTUALLY WORKS (verified against shipped 1.4.0 game files)
//
// Base/modules/base-standard/data/victories.xml declares <VictoryDominationPercents>:
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
// using the same filter the game's own tooltip uses (see calcTooltipForVictory in
// ui-next/screens/victories/victories-screen-model.js). The table above is documentation
// only, so a ToT DLC or a rules mod that edits those rows is picked up automatically.
//
// Science is NOT a domination victory: it has no rows in that table. It is a flat race to
// 100 Innovation, then an active Launch Pad held for 5 turns.
//
// Reaching a threshold starts a 5-turn countdown. Dropping back below it PAUSES the
// countdown (progress is saved, not reset) — either by losing points, or by 2nd place
// gaining enough to push the goal up.
// ─────────────────────────────────────────────────────────────────────────────────────────

const VF_TAG         = '[TOT-VF]';
const VF_BLOCK_CLASS = 'vf-forecast';

// Victory types, and the per-card CSS class the SolidJS summary tab puts on each column.
const VICTORY_DEFS = [
  { type: 'VICTORY_CULTURE_MODERN',  cardClass: 'victories-summary-cultural',   label: 'Cultural'   },
  { type: 'VICTORY_ECONOMIC_MODERN', cardClass: 'victories-summary-economic',   label: 'Economic'   },
  { type: 'VICTORY_MILITARY_MODERN', cardClass: 'victories-summary-military',   label: 'Military'   },
  { type: 'VICTORY_SCIENCE_MODERN',  cardClass: 'victories-summary-scientific', label: 'Scientific' },
];

const SCIENCE_TYPE            = 'VICTORY_SCIENCE_MODERN';
const SCIENCE_INNOVATION_GOAL = 100;   // flat, confirmed from Civilopedia
const COUNTDOWN_TURNS         = 5;     // confirmed from Civilopedia
const HISTORY_WINDOW          = 12;    // turns of samples kept for rate estimation
const MIN_SAMPLES_FOR_RATE    = 2;

function vfLog(msg, data) {
  try {
    console.error(VF_TAG, msg, data !== undefined ? JSON.stringify(data) : '');
  } catch { /* logging must never throw into the game UI */ }
}

// ── GAME DATA ────────────────────────────────────────────────────────────────────────────

function victoryHash(victoryTypeString) {
  try {
    if (typeof Database !== 'undefined' && Database.makeHash) return Database.makeHash(victoryTypeString);
  } catch { }
  try {
    return GameInfo.Victories?.lookup?.(victoryTypeString)?.$hash ?? null;
  } catch { }
  return null;
}

// Age progress as a percentage. This is exactly how victories-screen-model.js computes it.
function ageProgressPct() {
  try {
    const cur = Game.AgeProgressManager.getCurrentAgeProgressionPoints();
    const max = Game.AgeProgressManager.getMaxAgeProgressionPoints();
    if (!max) return null;
    return (cur / max) * 100;
  } catch {
    return null;
  }
}

function ageProgressPoints() {
  try { return Game.AgeProgressManager.getCurrentAgeProgressionPoints(); } catch { return null; }
}

// The tier ladder for one victory type, ASCENDING by MinAgeProgressPercent.
// Filter matches the game's own: campaign START age + how many ages have elapsed since.
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

function majorPlayers() {
  try { if (Players.getAliveMajors) return Players.getAliveMajors(); } catch { }
  try { return (Players.getAlive?.() ?? []).filter(p => p?.isMajor); } catch { }
  return [];
}

function playerLabel(player) {
  const raw = player?.name ?? player?.leaderName ?? player?.civilizationFullName ?? '';
  const name = localize(raw, String(raw || ''));
  return name || `Player ${player?.id ?? '?'}`;
}

// Current standings for one victory type, highest score first.
function leaderboard(victoryTypeString) {
  const hash = victoryHash(victoryTypeString);
  if (hash == null) return [];
  const rows = [];
  let localId = -1;
  try { localId = GameContext.localPlayerID; } catch { }

  for (const player of majorPlayers()) {
    let pts = 0;
    try { pts = Number(player.Victories?.getPointsForVictoryType?.(hash) ?? 0) || 0; } catch { }
    rows.push({ id: player.id, name: playerLabel(player), points: pts, isLocal: player.id === localId });
  }
  rows.sort((a, b) => b.points - a.points);
  return rows;
}

// The authoritative Point Goal the screen itself renders (-1 when the victory is locked).
function pointGoal(victoryTypeString) {
  try {
    const hash = victoryHash(victoryTypeString);
    if (hash == null) return -1;
    return Number(Game.VictoryManager.getCountdownVictoryDominanceScore(hash));
  } catch {
    return -1;
  }
}

// ── HISTORY & RATE ESTIMATION ────────────────────────────────────────────────────────────
//
// Score-per-turn cannot be read from the API, so we sample it. History lives for the
// session only; with too few samples we fall back to a static (no-growth) forecast, which
// is still exact for the question "would the lower threshold already be satisfied?".

const history = {
  turns: [],   // [{ turn, agePoints, scores: { victoryType: { playerId: points } } }]
};

function sampleNow() {
  let turn = null;
  try { turn = Game.turn; } catch { }
  if (turn == null) return;
  if (history.turns.length && history.turns[history.turns.length - 1].turn === turn) return;

  const scores = {};
  for (const def of VICTORY_DEFS) {
    const board = leaderboard(def.type);
    if (!board.length) continue;
    const byId = {};
    for (const row of board) byId[row.id] = row.points;
    scores[def.type] = byId;
  }

  history.turns.push({ turn, agePoints: ageProgressPoints(), scores });
  while (history.turns.length > HISTORY_WINDOW) history.turns.shift();
}

// Linear rate between the oldest and newest sample. null when there is not enough data.
function rateBetweenSamples(pick) {
  if (history.turns.length < MIN_SAMPLES_FOR_RATE) return null;
  const first = history.turns[0];
  const last  = history.turns[history.turns.length - 1];
  const dt    = last.turn - first.turn;
  if (dt <= 0) return null;
  const a = pick(first);
  const b = pick(last);
  if (a == null || b == null) return null;
  return (b - a) / dt;
}

function scoreRate(victoryType, playerId) {
  return rateBetweenSamples(s => s.scores?.[victoryType]?.[playerId]);
}

// Age-progress PERCENT gained per turn.
function agePctRate() {
  const ptsRate = rateBetweenSamples(s => s.agePoints);
  if (ptsRate == null || ptsRate <= 0) return null;
  try {
    const max = Game.AgeProgressManager.getMaxAgeProgressionPoints();
    if (!max) return null;
    return (ptsRate / max) * 100;
  } catch {
    return null;
  }
}

function turnsUntilAgePct(targetPct) {
  const cur  = ageProgressPct();
  const rate = agePctRate();
  if (cur == null || rate == null || rate <= 0) return null;
  if (targetPct <= cur) return 0;
  return Math.ceil((targetPct - cur) / rate);
}

// ── FORECAST ─────────────────────────────────────────────────────────────────────────────

// Project every player's score forward by `turnsAhead` and rank the result.
// When no rate is known, scores are held flat — the forecast then answers
// "does the lower threshold already reward the standings as they are?".
function projectBoard(victoryType, board, turnsAhead) {
  const projected = board.map(row => {
    const rate = scoreRate(victoryType, row.id);
    const grown = (rate != null && turnsAhead != null) ? row.points + rate * turnsAhead : row.points;
    return { ...row, projected: Math.max(0, grown), rate };
  });
  projected.sort((a, b) => b.projected - a.projected);
  return projected;
}

// A dominance victory is winnable by exactly one civ: only the leader can clear
// multiplier x runner-up.
function forecastDominanceTier(victoryType, board, tier) {
  const turnsAhead = turnsUntilAgePct(tier.minAgePct);
  const projected  = projectBoard(victoryType, board, turnsAhead);
  if (projected.length < 2) return null;

  const leader = projected[0];
  const second = projected[1];
  const goal   = second.projected * tier.multiplier;

  return {
    tier,
    turnsAhead,
    estimated: turnsAhead != null && projected.some(p => p.rate != null),
    leader,
    goal,
    onTrack: leader.projected >= goal && leader.projected > 0,
  };
}

function forecastScience(board) {
  // Flat race to 100 Innovation — several civs can be on track at once.
  const contenders = board.map(row => {
    const rate = scoreRate(SCIENCE_TYPE, row.id);
    const remaining = SCIENCE_INNOVATION_GOAL - row.points;
    const eta = (rate != null && rate > 0 && remaining > 0) ? Math.ceil(remaining / rate) : null;
    return { ...row, rate, eta, reached: row.points >= SCIENCE_INNOVATION_GOAL };
  });
  contenders.sort((a, b) => b.points - a.points);
  return contenders;
}

// ── RENDERING ────────────────────────────────────────────────────────────────────────────

const STYLE_ID = 'vf-forecast-style';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.vf-forecast {
  margin: 0.25rem 0.75rem 0.5rem;
  padding: 0.4rem 0.55rem;
  border: 1px solid rgba(201, 162, 39, 0.45);
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.38);
  font-size: 0.72rem;
  line-height: 1.4;
}
.vf-head {
  color: #c9a227;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  font-size: 0.64rem;
  margin-bottom: 0.25rem;
  border-bottom: 1px solid rgba(201, 162, 39, 0.25);
  padding-bottom: 0.15rem;
}
.vf-line { display: flex; justify-content: space-between; gap: 0.5rem; }
.vf-line + .vf-line { margin-top: 0.1rem; }
.vf-when  { color: #c9a227; opacity: 0.85; }
.vf-on    { color: #46d67a; font-weight: 600; }
.vf-off   { color: #98a1b0; }
.vf-name  { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vf-num   { opacity: 0.85; font-variant-numeric: tabular-nums; }
.vf-note  { color: #98a1b0; font-size: 0.62rem; opacity: 0.85; margin-top: 0.2rem; }
.vf-est   { color: #c9a227; opacity: 0.75; }
`;
  document.head.appendChild(style);
}

function fmt(n) {
  if (n == null || !isFinite(n)) return '—';
  const r = Math.round(n);
  try { return r.toLocaleString(); } catch { return String(r); }
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function line(leftText, leftCls, rightText) {
  const row = el('div', 'vf-line');
  row.appendChild(el('span', `vf-name ${leftCls ?? ''}`.trim(), leftText));
  if (rightText != null) row.appendChild(el('span', 'vf-num', rightText));
  return row;
}

function buildDominanceBlock(victoryType, agePct) {
  const ladder = tierLadder(victoryType);
  if (!ladder.length) return null;

  const { current, upcoming } = splitTiers(ladder, agePct);
  const board = leaderboard(victoryType);
  if (board.length < 2) return null;

  const box = el('div', VF_BLOCK_CLASS);

  if (!upcoming.length) {
    box.appendChild(el('div', 'vf-head', 'Final tier reached'));
    const goalNow = pointGoal(victoryType);
    const leader  = board[0];
    const met     = goalNow > 0 && leader.points >= goalNow;
    box.appendChild(line(
      `${met ? '✓' : '✗'} ${leader.name}`,
      met ? 'vf-on' : 'vf-off',
      `${fmt(leader.points)} / ${fmt(goalNow)}`,
    ));
    box.appendChild(el('div', 'vf-note',
      current ? `No further reductions after ${localize(current.nameKey, 'current tier')}.` : ''));
    return box;
  }

  // Look at the next two reductions — that is the window the player can actually plan for.
  const tiers = upcoming.slice(0, 2);
  let anyEstimated = false;

  box.appendChild(el('div', 'vf-head', 'Forecast — next point goal drops'));

  for (let i = 0; i < tiers.length; i++) {
    const fc = forecastDominanceTier(victoryType, board, tiers[i]);
    if (!fc) continue;
    if (fc.estimated) anyEstimated = true;

    const tierName = localize(fc.tier.nameKey, `${fc.tier.multiplier}x tier`);
    const when = fc.turnsAhead != null
      ? `${fc.tier.minAgePct}% age · ~${fc.turnsAhead}t`
      : `${fc.tier.minAgePct}% age`;

    const header = el('div', 'vf-line');
    header.appendChild(el('span', 'vf-name vf-when',
      `${i === 0 ? '▶' : '·'} ${tierName} ×${fc.tier.multiplier}`));
    header.appendChild(el('span', 'vf-num vf-when', when));
    box.appendChild(header);

    if (fc.onTrack) {
      box.appendChild(line(
        `✓ ${fc.leader.name} ON TRACK`,
        'vf-on',
        `${fmt(fc.leader.projected)} / ${fmt(fc.goal)}`,
      ));
    } else {
      box.appendChild(line(
        `✗ ${fc.leader.name} short`,
        'vf-off',
        `${fmt(fc.leader.projected)} / ${fmt(fc.goal)}`,
      ));
    }
  }

  box.appendChild(el('div', 'vf-note', anyEstimated
    ? `Projected from recent score rate · ${COUNTDOWN_TURNS}-turn countdown follows`
    : `Standings held flat — play a turn or two for a trend-based projection`));

  return box;
}

function buildScienceBlock() {
  const board = leaderboard(SCIENCE_TYPE);
  if (!board.length) return null;

  const box = el('div', VF_BLOCK_CLASS);
  box.appendChild(el('div', 'vf-head', `Forecast — race to ${SCIENCE_INNOVATION_GOAL} innovation`));

  const contenders = forecastScience(board).slice(0, 3);
  let sawEta = false;

  for (const c of contenders) {
    if (c.reached) {
      box.appendChild(line(`✓ ${c.name} at goal`, 'vf-on', `${fmt(c.points)} / ${SCIENCE_INNOVATION_GOAL}`));
    } else if (c.eta != null) {
      sawEta = true;
      box.appendChild(line(`▶ ${c.name} ~${c.eta}t`, 'vf-on', `${fmt(c.points)} / ${SCIENCE_INNOVATION_GOAL}`));
    } else {
      box.appendChild(line(`· ${c.name}`, 'vf-off', `${fmt(c.points)} / ${SCIENCE_INNOVATION_GOAL}`));
    }
  }

  box.appendChild(el('div', 'vf-note', sawEta
    ? `Then hold an active Launch Pad for ${COUNTDOWN_TURNS} turns`
    : `Play a turn or two for an ETA · needs a Launch Pad held ${COUNTDOWN_TURNS} turns`));

  return box;
}

// ── INJECTION ────────────────────────────────────────────────────────────────────────────

function victoryTypeForCard(card) {
  for (const def of VICTORY_DEFS) {
    if (card.classList?.contains(def.cardClass)) return def.type;
  }
  return null;
}

function findCards() {
  const found = new Set();
  document.querySelectorAll('[data-name="SummaryVictoryCard"], .victories-summary-box')
    .forEach(node => found.add(node));
  return Array.from(found);
}

function injectInto(card) {
  const victoryType = victoryTypeForCard(card);
  if (!victoryType) return false;

  const agePct = ageProgressPct();
  if (agePct == null) return false;

  // Locked victories render pointGoal -1; leave those columns untouched.
  if (victoryType !== SCIENCE_TYPE && pointGoal(victoryType) === -1) return false;

  const block = victoryType === SCIENCE_TYPE
    ? buildScienceBlock()
    : buildDominanceBlock(victoryType, agePct);
  if (!block) return false;

  // Coherent GT is not a full modern browser: `:scope` selectors and Element.replaceWith
  // are not dependable across builds. Scan direct children and swap manually instead.
  let existing = null;
  for (const child of Array.from(card.children || [])) {
    if (child.classList?.contains(VF_BLOCK_CLASS)) { existing = child; break; }
  }
  if (existing) card.replaceChild(block, existing);
  else card.appendChild(block);
  return true;
}

function refreshAll(reason) {
  let injected = 0;
  const cards = findCards();
  for (const card of cards) {
    try { if (injectInto(card)) injected++; } catch (e) { vfLog('inject failed', String(e)); }
  }
  if (cards.length) vfLog('refresh', { reason, cards: cards.length, injected });
  return injected;
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
    sampleNow();
    this._observe();
    this._listen();
    this._diagnostics();
    this._schedule('init');
  }

  // The victory screen is SolidJS and re-renders on tab switch, so watch for card nodes
  // appearing anywhere under body rather than binding to one panel instance.
  _observe() {
    try {
      this._observer = new MutationObserver(mutations => {
        for (const mut of mutations) {
          for (const node of mut.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.matches?.('[data-name="SummaryVictoryCard"], .victories-summary-box') ||
                node.querySelector?.('[data-name="SummaryVictoryCard"], .victories-summary-box')) {
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
    // Sample scores once per turn so the rate estimate has data to work with.
    on('PlayerTurnActivated', () => { sampleNow(); this._schedule('turn'); });
    on('TurnBegin',           () => { sampleNow(); this._schedule('turn'); });
    // Fired by the game when a tier boundary is crossed — the goal just dropped.
    on('VictoryThresholdChanged', () => { sampleNow(); this._schedule('threshold'); });
  }

  // Coalesce bursts of mutations into one rebuild on the next frame.
  _schedule(reason) {
    if (this._pending) return;
    this._pending = true;
    const run = () => {
      this._pending = null;
      try { sampleNow(); refreshAll(reason); } catch (e) { vfLog('refresh failed', String(e)); }
    };
    try { requestAnimationFrame(() => setTimeout(run, 30)); } catch { setTimeout(run, 50); }
  }

  // One-shot dump so a single in-game run tells us whether every assumption held.
  _diagnostics() {
    try {
      const agePct = ageProgressPct();
      const summary = VICTORY_DEFS.map(def => {
        const ladder = tierLadder(def.type);
        const board  = leaderboard(def.type);
        return {
          type:   def.type,
          goal:   pointGoal(def.type),
          tiers:  ladder.map(t => `${t.minAgePct}%:x${t.multiplier}`),
          top:    board.slice(0, 2).map(b => `${b.name}=${b.points}`),
        };
      });
      vfLog('diagnostics', {
        agePct: agePct != null ? Math.round(agePct) : null,
        turn:   (() => { try { return Game.turn; } catch { return null; } })(),
        age:    (() => { try { return GameInfo.Ages.lookup(Game.age)?.AgeType; } catch { return null; } })(),
        prevAgeCount: (() => { try { return Configuration.getGame().previousAgeCount; } catch { return null; } })(),
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
