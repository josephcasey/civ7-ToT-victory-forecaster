// Civ7 Test of Time Victory Forecaster — Phase 1
//
// Automatically augments every panel-advisor-victory on the victory screen
// with a per-player ON TRACK forecast strip. No button, no user action required.
//
// ToT Dominance victories (Military / Culture / Economic):
//   Win = hold (score ≥ multiplier × 2nd-place score) for 5 turns.
//   Modern age multipliers lower over time: 3× → 2× → 1.5× → 1.25×
//
// Science victory:
//   Win = reach 100 Innovation points + launch pad + 5-turn countdown.

// ── THRESHOLD CONSTANTS ────────────────────────────────────────────
//
// Multipliers are confirmed from the ToT Dev Diary (2026-05-19).
// agePoints timing is ESTIMATED at equal spacing across 200 pts (standard speed).
// Calibrate by watching the threshold-change event in-game and updating these values.

const MODERN_THRESHOLDS = [
  { agePoints:   0, multiplier: 3.00 },
  { agePoints:  60, multiplier: 2.00 },
  { agePoints: 100, multiplier: 1.50 },
  { agePoints: 150, multiplier: 1.25 },
];

const SCIENCE_INNOVATION_TARGET = 100;   // confirmed from dev diary
const MODERN_AGE_TYPE            = 'AGE_MODERN';
const VF_SECTION_CLASS           = 'vf-forecast-section';
const VF_LOG_TAG                 = '[TOT-VF]';
const MODEL_UPDATE_CHAIN_DELAY   = 600; // ms — wait for panel module to set model.onUpdate first

// ── LOGGING ────────────────────────────────────────────────────────

function vfLog(msg, data) {
  try {
    console.error(VF_LOG_TAG, msg, data !== undefined ? JSON.stringify(data) : '');
  } catch { /* never throw from logging */ }
}

// ── GAME DATA HELPERS ──────────────────────────────────────────────

// Convert the advisor-type attribute (number) to the legacy-path class string.
// AdvisorTypes is a global enum in Civ7; we build the map at runtime.
const ADVISOR_TO_CLASS = (() => {
  if (typeof AdvisorTypes !== 'undefined') {
    return new Map([
      [AdvisorTypes.SCIENCE,  'LEGACY_PATH_CLASS_SCIENCE'],
      [AdvisorTypes.MILITARY, 'LEGACY_PATH_CLASS_MILITARY'],
      [AdvisorTypes.CULTURE,  'LEGACY_PATH_CLASS_CULTURE'],
      [AdvisorTypes.ECONOMIC, 'LEGACY_PATH_CLASS_ECONOMIC'],
    ]);
  }
  // Numeric fallback — values match the standard Civ7 AdvisorTypes enum.
  return new Map([
    [1, 'LEGACY_PATH_CLASS_SCIENCE'],
    [2, 'LEGACY_PATH_CLASS_MILITARY'],
    [3, 'LEGACY_PATH_CLASS_CULTURE'],
    [4, 'LEGACY_PATH_CLASS_ECONOMIC'],
  ]);
})();

function getClassType(advisorTypeAttr) {
  return ADVISOR_TO_CLASS.get(Number(advisorTypeAttr)) ?? null;
}

function getCurrentAgeType() {
  try {
    return GameInfo?.Ages?.lookup?.(Game.age)?.AgeType ?? null;
  } catch { return null; }
}

function getCurrentAgePoints() {
  try {
    const mgr = Game.AgeProgressManager;
    if (!mgr) return 0;
    // Try every property name the engine version may use.
    for (const k of ['currentPoints', 'progressPoints', 'totalProgressPoints', 'points']) {
      const v = typeof mgr[k] === 'function' ? mgr[k]() : mgr[k];
      if (typeof v === 'number' && isFinite(v) && v >= 0) return v;
    }
  } catch { /* fall through */ }
  try { return typeof Game.turn === 'number' ? Game.turn : 0; } catch { return 0; }
}

function getMaxAgePoints() {
  try {
    const ageType = getCurrentAgeType();
    const row = GameInfo?.AgeProgressions?.find?.(r => r.AgeType === ageType);
    if (row) return row.MaxPoints_Standard ?? 200;
  } catch { /* fall through */ }
  return 200;
}

// Read all players' score entries for one victory type.
// Returns Array<{isLocal, pid, score, maxScore}> or null if unavailable.
function readPlayerScores(classType) {
  const ageType = getCurrentAgeType();
  if (!ageType) { vfLog('no ageType'); return null; }

  // Primary source: g_AdvisorProgressModel (keyed by ageType string, already processed).
  let ageData = null;
  try {
    const model = window.g_AdvisorProgressModel;
    if (model?.victoryData?.get) {
      ageData = model.victoryData.get(ageType);
    }
  } catch { /* ignore */ }

  // Fallback: VictoryManager global if exposed.
  if (!ageData) {
    try {
      const raw = typeof VictoryManager !== 'undefined'
        ? VictoryManager?.processedVictoryData
        : null;
      if (raw?.get) {
        ageData = raw.get(ageType) ?? raw.get(Game.age);
      }
    } catch { /* ignore */ }
  }

  if (!ageData) { vfLog('no ageData', { ageType }); return null; }

  const vc = ageData.find(v => (v.ClassType ?? v.classType) === classType);
  if (!vc?.playerData) { vfLog('no playerData', { classType }); return null; }

  return Array.from(vc.playerData).map(p => ({
    isLocal:  p.isLocalPlayer ?? false,
    pid:      p.playerId ?? p.playerID ?? p.id ?? p.ID ?? null,
    score:    p.currentScore ?? p.CurrentScore ?? 0,
    maxScore: p.maxScore    ?? p.MaxScore     ?? 0,
  }));
}

function getPlayerLabel(p, fallbackIndex) {
  if (p.isLocal) {
    try {
      const pl = Players.get(GameContext.localPlayerID);
      return (pl?.name ?? pl?.civName ?? 'You') + ' ★'; // ★
    } catch { return 'You ★'; }
  }
  if (p.pid != null) {
    try {
      const pl = Players.get(p.pid);
      const n = pl?.name ?? pl?.civName ?? null;
      if (n) return n;
    } catch { /* ignore */ }
  }
  return `Opponent ${fallbackIndex + 1}`;
}

// ── THRESHOLD LOGIC ────────────────────────────────────────────────

function activeThreshold(agePoints) {
  let t = MODERN_THRESHOLDS[0];
  for (const entry of MODERN_THRESHOLDS) {
    if (entry.agePoints <= agePoints) t = entry;
  }
  return t;
}

function upcomingThresholds(agePoints) {
  return MODERN_THRESHOLDS.filter(t => t.agePoints > agePoints);
}

// For a Dominance victory: is this player projected to satisfy any of the next 2
// threshold lowerings before they occur (linear extrapolation)?
function dominanceOnTrack(player, allPlayers, agePoints) {
  if (agePoints <= 0 || player.score <= 0) return { onTrack: false };
  const myRate = player.score / agePoints;
  const others = allPlayers.filter(p => p !== player);

  for (const t of upcomingThresholds(agePoints).slice(0, 2)) {
    const ahead   = t.agePoints - agePoints;
    const myProj  = player.score + myRate * ahead;
    const otherPr = others.map(p => p.score + (agePoints > 0 ? (p.score / agePoints) * ahead : 0));
    const secondPr = otherPr.length ? Math.max(...otherPr) : 0;

    if (myProj >= t.multiplier * Math.max(secondPr, 1)) {
      return { onTrack: true, multiplier: t.multiplier, atPoints: t.agePoints };
    }
  }
  return { onTrack: false };
}

// For Science: is this player projected to reach 100 Innovation before the age ends?
function scienceOnTrack(player, agePoints, maxAgePoints) {
  if (player.score >= SCIENCE_INNOVATION_TARGET) return { onTrack: true, alreadyMet: true };
  if (agePoints <= 0) return { onTrack: false };
  const rate = player.score / agePoints;
  if (rate <= 0) return { onTrack: false };
  return { onTrack: player.score + rate * (maxAgePoints - agePoints) >= SCIENCE_INNOVATION_TARGET };
}

// ── DOM INJECTION ──────────────────────────────────────────────────

function injectForecast(panelEl) {
  // Remove stale section on re-inject.
  panelEl.querySelector('.' + VF_SECTION_CLASS)?.remove();

  const advisorAttr = panelEl.getAttribute('advisor-type');
  if (advisorAttr == null) return;

  const classType = getClassType(advisorAttr);
  if (!classType) { vfLog('unknown advisor type', { advisorAttr }); return; }

  const ageType   = getCurrentAgeType();
  const isModern  = ageType === MODERN_AGE_TYPE;
  const isScience = classType === 'LEGACY_PATH_CLASS_SCIENCE';
  const agePoints = getCurrentAgePoints();
  const maxPts    = getMaxAgePoints();
  const active    = activeThreshold(agePoints);
  const upcoming  = upcomingThresholds(agePoints);

  const players = readPlayerScores(classType);
  if (!players || players.length === 0) {
    vfLog('no player scores', { classType, ageType });
    return;
  }

  // Sort descending by score; compute ON TRACK for each.
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score ?? 1;

  const rows = sorted.map((p, i) => {
    let track;
    if (!isModern) {
      track = { onTrack: false };
    } else if (isScience) {
      track = scienceOnTrack(p, agePoints, maxPts);
    } else {
      track = dominanceOnTrack(p, sorted, agePoints);
    }
    return { p, rank: i + 1, track };
  });

  // ── Build section element ────────────────────────────────────────

  const section = document.createElement('div');
  section.className = VF_SECTION_CLASS;
  Object.assign(section.style, {
    marginTop:  '14px',
    padding:    '8px 14px 10px',
    borderTop:  '1px solid rgba(255,255,255,0.10)',
    fontFamily: 'Arial,sans-serif',
    fontSize:   '11px',
    color:      '#c8ced4',
    lineHeight: '1.35',
  });

  // Header row: "VICTORY TRACK" left, threshold chain right
  const header = document.createElement('div');
  Object.assign(header.style, {
    display:        'flex',
    justifyContent: 'space-between',
    alignItems:     'center',
    marginBottom:   '7px',
  });

  const headerTitle = document.createElement('span');
  headerTitle.textContent = 'Victory Track';
  Object.assign(headerTitle.style, {
    color:         '#f6d56e',
    fontSize:      '10px',
    fontWeight:    'bold',
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
  });

  const headerRight = document.createElement('span');
  Object.assign(headerRight.style, { color: '#607080', fontSize: '10px' });
  if (isModern) {
    headerRight.textContent = upcoming.length
      ? [active, ...upcoming.slice(0, 2)].map(t => t.multiplier + '×').join(' → ')
      : active.multiplier + '× (final)';
  } else {
    headerRight.textContent = 'Modern age only';
  }

  header.appendChild(headerTitle);
  header.appendChild(headerRight);
  section.appendChild(header);

  // Player rows
  for (const { p, rank, track } of rows) {
    const label  = getPlayerLabel(p, rank - 1);
    const barPct = topScore > 0 ? Math.min(100, (p.score / topScore) * 100) : 0;
    const score  = Math.round(p.score);

    const row = document.createElement('div');
    Object.assign(row.style, {
      display:      'flex',
      alignItems:   'center',
      gap:          '7px',
      padding:      '2px 4px',
      borderRadius: '3px',
      marginBottom: '1px',
      background:   (track.onTrack && isModern) ? 'rgba(38,95,48,0.22)' : 'transparent',
    });

    // Rank number
    const rankEl = document.createElement('span');
    rankEl.textContent = rank + '.';
    Object.assign(rankEl.style, {
      width:     '16px',
      textAlign: 'right',
      color:     rank === 1 ? '#f6d56e' : '#4a5a6a',
      fontSize:  '10px',
      flexShrink:'0',
    });

    // Player name
    const nameEl = document.createElement('span');
    nameEl.textContent = label;
    Object.assign(nameEl.style, {
      width:        '120px',
      flexShrink:   '0',
      overflow:     'hidden',
      textOverflow: 'ellipsis',
      whiteSpace:   'nowrap',
      color:        p.isLocal ? '#f6d56e' : '#b8c4d0',
      fontSize:     '11px',
    });

    // Mini bar track
    const barTrack = document.createElement('div');
    Object.assign(barTrack.style, {
      flex:        '1',
      height:      '3px',
      background:  'rgba(255,255,255,0.07)',
      borderRadius:'2px',
      overflow:    'hidden',
      minWidth:    '48px',
    });
    const barFill = document.createElement('div');
    Object.assign(barFill.style, {
      height:      '100%',
      width:       barPct.toFixed(1) + '%',
      background:  (track.onTrack && isModern)
        ? '#3aaa4a'
        : (rank === 1 ? '#c8a030' : '#3a5070'),
      borderRadius:'2px',
      transition:  'width 0.3s ease',
    });
    barTrack.appendChild(barFill);

    // Score
    const scoreEl = document.createElement('span');
    scoreEl.textContent = score.toLocaleString();
    Object.assign(scoreEl.style, {
      width:     '44px',
      textAlign: 'right',
      color:     '#708090',
      flexShrink:'0',
      fontSize:  '10px',
    });

    // ON TRACK badge (or empty spacer)
    const badgeEl = document.createElement('span');
    Object.assign(badgeEl.style, { flexShrink: '0', minWidth: '34px', textAlign: 'left' });
    if (track.onTrack && isModern) {
      const label = track.alreadyMet
        ? 'MET'
        : ('×' + (track.multiplier ?? ''));   // ×1.5 etc.
      badgeEl.textContent = label;
      Object.assign(badgeEl.style, {
        display:     'inline-block',
        padding:     '1px 4px',
        background:  '#1b5425',
        color:       '#6dfa7e',
        border:      '1px solid #378a46',
        borderRadius:'3px',
        fontSize:    '9px',
        fontWeight:  'bold',
      });
    }

    row.appendChild(rankEl);
    row.appendChild(nameEl);
    row.appendChild(barTrack);
    row.appendChild(scoreEl);
    row.appendChild(badgeEl);
    section.appendChild(row);
  }

  // Footer note
  if (isModern && upcoming.length > 0) {
    const hint = document.createElement('div');
    Object.assign(hint.style, {
      marginTop:  '7px',
      color:      '#464e58',
      fontSize:   '9px',
      lineHeight: '1.4',
    });
    const next = upcoming[0];
    hint.textContent = `×${next.multiplier} badge = projected to lead by ${next.multiplier}× 2nd-place at ~${next.agePoints} age pts ⚠️ timing est.`;
    section.appendChild(hint);
  }

  // Attach to the wrapper the panel renders into.
  // The panel creates: <div class="advisor-panal_wrapper">…</div>
  // Note: "panal" is a typo in the original source — match it exactly.
  const wrapper = panelEl.querySelector('.advisor-panal_wrapper') ?? panelEl;
  wrapper.appendChild(section);

  vfLog('injected', { classType, players: sorted.length, agePoints, isModern });
}

// ── CONTROLLER ─────────────────────────────────────────────────────

class VFController {
  static _instance = null;
  _observer = null;

  constructor() {
    engine.whenReady.then(() => this._onReady());
  }

  static getInstance() {
    if (!VFController._instance) VFController._instance = new VFController();
    return VFController._instance;
  }

  _onReady() {
    vfLog('ready');
    this._setupMutationObserver();
    // Catch any panels already in the DOM.
    document.querySelectorAll('panel-advisor-victory').forEach(el => this._schedule(el));
    // Chain onto the model's update callback after the panel module has set it up.
    setTimeout(() => this._chainModelUpdate(), MODEL_UPDATE_CHAIN_DELAY);
  }

  _setupMutationObserver() {
    this._observer = new MutationObserver(mutations => {
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.tagName?.toLowerCase() === 'panel-advisor-victory') {
            this._schedule(node);
          } else {
            node.querySelectorAll?.('panel-advisor-victory')
              .forEach(el => this._schedule(el));
          }
        }
      }
    });
    this._observer.observe(document.body, { childList: true, subtree: true });
  }

  // Debounce and defer injection until the panel has finished rendering.
  _schedule(el) {
    const now = Date.now();
    if (now - (el._vfStamp ?? 0) < 150) return;
    el._vfStamp = now;
    requestAnimationFrame(() => {
      try { injectForecast(el); } catch (e) { vfLog('inject error', { err: String(e) }); }
    });
  }

  // Chain our refresh onto the AdvisorProgressModel's update callback so that
  // forecast strips update whenever VictoryManager pushes new data.
  _chainModelUpdate() {
    try {
      const model = window.g_AdvisorProgressModel;
      if (!model) { vfLog('g_AdvisorProgressModel not found — live updates disabled'); return; }

      const orig = model.onUpdate;
      model.onUpdate = m => {
        if (typeof orig === 'function') orig(m);
        // Brief delay so the model's victoryData is committed before we re-read.
        setTimeout(() => {
          document.querySelectorAll('panel-advisor-victory')
            .forEach(el => { try { injectForecast(el); } catch { /* ignore */ } });
        }, 80);
      };
      vfLog('chained onto g_AdvisorProgressModel.onUpdate');
    } catch (e) {
      vfLog('could not chain model update', { err: String(e) });
    }
  }
}

VFController.getInstance();

//# sourceMappingURL=victory-forecaster.js.map
