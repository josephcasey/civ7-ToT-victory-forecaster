// Civ7 Test of Time Victory Forecaster — Phase 1
// Flags players "on victory track" when their projected score will meet
// the next (or subsequent) ToT threshold lowering in the Modern age.
//
// Dominance victory (Military / Culture / Economic):
//   Win = hold (own score ≥ multiplier × second-place score) for 5 turns.
//   Modern age multipliers lower over time: 3× → 2× → 1.5× → 1.25×
// Science victory:
//   Win = reach 100 Innovation points + have a launch pad + 5-turn countdown.

// ── CONSTANTS ──────────────────────────────────────────────────────

const VF_LOG_TAG   = '[TOT-VF]';
const VF_BUTTON_ID = 'vf-forecaster-button';
const VF_POPUP_ID  = 'vf-forecaster-popup';

const MOD_DISPLAY_NAME  = 'Victory Forecaster';
const MOD_VERSION_LABEL = 'v0.1 · ToT 1.4.0';

// Modern Age threshold schedule.
// Each entry becomes active at (or after) the listed cumulative age-progression points.
// Source: Civ7 Test of Time Dev Diary, 2026-05-19 — multipliers confirmed.
// ⚠ TIMING (agePoints) is ESTIMATED from equal-spacing across 200 pts (standard speed).
//   Verify by watching the in-game threshold change events and update these values.
const MODERN_THRESHOLDS = [
  { agePoints:   0, multiplier: 3.00 },
  { agePoints:  60, multiplier: 2.00 },
  { agePoints: 100, multiplier: 1.50 },
  { agePoints: 150, multiplier: 1.25 },
];

// Science victory: fixed Innovation point target (confirmed from dev diary).
const SCIENCE_INNOVATION_TARGET = 100;

// Maximum age-progression points by game speed (from victories.xml).
const MAX_AGE_POINTS_BY_SPEED = {
  Abbreviated: 160,
  Standard:    200,
  Long:        240,
};
const MAX_AGE_POINTS_DEFAULT = 200;

// Hold duration (turns) required once threshold is met (confirmed from dev diary).
const DOMINANCE_HOLD_TURNS = 5;

// Victory class-type strings to recognise in processedVictoryData.
// The ToT DLC may use either the legacy-path class keys or the victory class keys —
// we try both so the mod works regardless of which the DLC registers.
const CLASS_KEYS = {
  Military: ['LEGACY_PATH_CLASS_MILITARY', 'VICTORY_CLASS_MILITARY'],
  Science:  ['LEGACY_PATH_CLASS_SCIENCE',  'VICTORY_CLASS_SCIENCE'],
  Culture:  ['LEGACY_PATH_CLASS_CULTURE',  'VICTORY_CLASS_CULTURE'],
  Economic: ['LEGACY_PATH_CLASS_ECONOMIC', 'VICTORY_CLASS_ECONOMIC'],
};

const MODERN_AGE_TYPE = 'AGE_MODERN';

const TOP_BAR_ANCHOR    = '#ps-icons';
const INJECT_INTERVAL   = 500;   // ms between injection attempts
const INJECT_MAX_TRIES  = 60;

// ── LOGGING ────────────────────────────────────────────────────────

function vfLog(msg, data) {
  try {
    console.error(VF_LOG_TAG, msg, data !== undefined ? JSON.stringify(data) : '');
  } catch { /* never throw from logging */ }
}

// ── SINGLETON ──────────────────────────────────────────────────────

class VFController {
  static _instance = null;

  _button       = null;
  _popup        = null;
  _injectTries  = 0;
  _outsideClick = null;

  constructor() {
    engine.whenReady.then(() => this._onReady());
  }

  static getInstance() {
    if (!VFController._instance) {
      VFController._instance = new VFController();
    }
    return VFController._instance;
  }

  _onReady() {
    vfLog('controller ready');
    this._scheduleInjection();
  }

  // ── AGE PROGRESS ────────────────────────────────────────────────

  _getCurrentAgeType() {
    try {
      return GameInfo?.Ages?.lookup(Game.age)?.AgeType ?? null;
    } catch { return null; }
  }

  // Current cumulative age-progression points.
  _getAgePoints() {
    try {
      const mgr = Game.AgeProgressManager;
      if (!mgr) return null;
      // Try every property name the engine might use.
      for (const k of ['currentPoints', 'getCurrentPoints', 'totalProgressPoints', 'progressPoints', 'points']) {
        const v = typeof mgr[k] === 'function' ? mgr[k]() : mgr[k];
        if (typeof v === 'number' && isFinite(v)) return v;
      }
    } catch { /* fall through */ }
    // Last resort: current turn number (1 turn ≈ 1 age point).
    try {
      const t = Game.turn;
      if (typeof t === 'number') return t;
    } catch { /* ignore */ }
    return null;
  }

  // Maximum age-progression points for the current game speed.
  _getMaxAgePoints() {
    try {
      const ageType = this._getCurrentAgeType();
      const row = GameInfo?.AgeProgressions?.find(r => r.AgeType === ageType);
      if (row) {
        // Try to infer game speed from known speed names.
        const speedName = Configuration?.getGame?.()?.gameSpeed ?? '';
        if (/long/i.test(speedName))        return row.MaxPoints_Long        ?? MAX_AGE_POINTS_DEFAULT;
        if (/abbrev|quick/i.test(speedName)) return row.MaxPoints_Abbreviated ?? MAX_AGE_POINTS_DEFAULT;
        return row.MaxPoints_Standard ?? MAX_AGE_POINTS_DEFAULT;
      }
    } catch { /* ignore */ }
    return MAX_AGE_POINTS_DEFAULT;
  }

  // ── SCORE DATA ──────────────────────────────────────────────────

  // Returns Map<victoryLabel, Array<{pid, score, isLocal}>>
  // where pid may be null if the engine does not expose it.
  _readAllScores() {
    try {
      const raw = VictoryManager?.processedVictoryData;
      if (!raw) { vfLog('VictoryManager.processedVictoryData unavailable'); return null; }

      const ageHash = Game.age;
      let ageData = typeof raw.get === 'function' ? raw.get(ageHash) : null;

      if (!ageData) {
        // Dump available keys to aid debugging.
        if (typeof raw.entries === 'function') {
          for (const [k, v] of raw.entries()) {
            vfLog('processedVictoryData key', { key: String(k), numEntries: v?.length });
          }
        }
        vfLog('no ageData for current age hash', { ageHash: String(ageHash) });
        return null;
      }

      const result = new Map();

      for (const vc of ageData) {
        const ct = vc.ClassType ?? vc.classType ?? '';
        // Match against known victory type keys.
        for (const [label, keys] of Object.entries(CLASS_KEYS)) {
          if (!keys.includes(ct)) continue;
          const players = [];
          for (const p of (vc.playerData ?? [])) {
            players.push({
              pid:     p.playerId  ?? p.playerID  ?? p.id  ?? p.ID  ?? null,
              score:   p.currentScore ?? p.CurrentScore ?? 0,
              maxScore:p.maxScore    ?? p.MaxScore    ?? 0,
              isLocal: p.isLocalPlayer ?? false,
            });
          }
          result.set(label, players);
          vfLog(`read ${label}`, { ct, count: players.length });
          break;
        }
      }

      return result.size > 0 ? result : null;
    } catch (e) {
      vfLog('error reading scores', { err: String(e) });
      return null;
    }
  }

  _getPlayerName(pid) {
    if (pid == null) return '(unknown)';
    try {
      const p = Players.get(pid);
      if (!p) return `Player ${pid}`;
      return p.name ?? p.Name ?? p.leaderName ?? p.civName ?? `Player ${pid}`;
    } catch { return `Player ${pid}`; }
  }

  // ── THRESHOLD LOGIC ─────────────────────────────────────────────

  _activeThreshold(agePoints) {
    let active = MODERN_THRESHOLDS[0];
    for (const t of MODERN_THRESHOLDS) {
      if (t.agePoints <= agePoints) active = t;
    }
    return active;
  }

  _upcomingThresholds(agePoints) {
    return MODERN_THRESHOLDS.filter(t => t.agePoints > agePoints);
  }

  // Check whether `player` will meet any of the next 2 threshold lowerings.
  // For dominance types: projected score >= multiplier × projected 2nd-place score.
  // Returns { onTrack, multiplier, atAgePoints } | { onTrack: false }.
  _dominanceOnTrack(player, allPlayers, agePoints) {
    if (agePoints <= 0 || player.score <= 0) return { onTrack: false };

    const myRate = player.score / agePoints;

    const others = allPlayers.filter(p => p !== player);

    for (const t of this._upcomingThresholds(agePoints).slice(0, 2)) {
      const ahead = t.agePoints - agePoints;
      const myProj = player.score + myRate * ahead;

      // Project each other player's score (assume same linear rate).
      const otherProj = others.map(p => {
        const r = agePoints > 0 ? p.score / agePoints : 0;
        return p.score + r * ahead;
      });
      const secondProj = otherProj.length > 0 ? Math.max(...otherProj) : 0;

      if (myProj >= t.multiplier * Math.max(secondProj, 1)) {
        return { onTrack: true, multiplier: t.multiplier, atAgePoints: t.agePoints, projScore: Math.round(myProj) };
      }
    }
    return { onTrack: false };
  }

  // Science: will this player reach the innovation target before the age ends?
  _scienceOnTrack(player, agePoints, maxAgePoints) {
    if (player.score >= SCIENCE_INNOVATION_TARGET) {
      return { onTrack: true, alreadyMet: true };
    }
    if (agePoints <= 0) return { onTrack: false };
    const rate = player.score / agePoints;
    if (rate <= 0) return { onTrack: false };
    const projAtEnd = player.score + rate * (maxAgePoints - agePoints);
    return {
      onTrack:  projAtEnd >= SCIENCE_INNOVATION_TARGET,
      projAtEnd: Math.round(projAtEnd),
    };
  }

  // ── FORECAST ────────────────────────────────────────────────────

  _computeForecast() {
    const ageType   = this._getCurrentAgeType();
    const agePoints = this._getAgePoints() ?? 0;
    const maxPts    = this._getMaxAgePoints();
    const isModern  = ageType === MODERN_AGE_TYPE;
    const allScores = this._readAllScores();

    const active   = this._activeThreshold(agePoints);
    const upcoming = this._upcomingThresholds(agePoints);

    // Build per-player result rows.
    // players: Map<rowKey, { name, isLocal, vtResults: Map<label, result> }>
    const players = new Map();

    const addPlayer = (pid, isLocal, label, vtResult, score) => {
      const key = pid != null ? String(pid) : (isLocal ? '__local__' : `__rank_${score}`);
      if (!players.has(key)) {
        players.set(key, {
          name:    isLocal ? (this._getPlayerName(pid) + ' ★') : this._getPlayerName(pid),
          isLocal,
          vtResults: new Map(),
        });
      }
      players.get(key).vtResults.set(label, vtResult);
    };

    if (allScores) {
      for (const [label, pList] of allScores) {
        const sorted = [...pList].sort((a, b) => b.score - a.score);
        for (let rank = 0; rank < sorted.length; rank++) {
          const p = sorted[rank];
          let result;
          if (label === 'Science') {
            result = isModern
              ? { rank: rank + 1, score: p.score, ...this._scienceOnTrack(p, agePoints, maxPts) }
              : { rank: rank + 1, score: p.score, onTrack: false };
          } else {
            result = isModern
              ? { rank: rank + 1, score: p.score, ...this._dominanceOnTrack(p, sorted, agePoints) }
              : { rank: rank + 1, score: p.score, onTrack: false };
          }
          addPlayer(p.pid, p.isLocal, label, result, p.score);
        }
      }
    }

    return { ageType, isModern, agePoints, maxPts, active, upcoming, players, hasData: allScores != null };
  }

  // ── POPUP RENDERING ─────────────────────────────────────────────

  _renderBody(fc) {
    if (!fc.hasData) {
      return `
        <div style="color:#f08080;font-size:12px;margin-top:8px;">
          ⚠ Could not read victory data from the game API.<br>
          Open the browser console and search for <code>[TOT-VF]</code> to see debug info.
        </div>`;
    }

    if (fc.players.size === 0) {
      return `<div style="color:#f6d56e;font-size:12px;margin-top:8px;">
        No player data found yet — try opening the Victory Progress screen first,
        or wait until the Modern age begins.
      </div>`;
    }

    const labels = Object.keys(CLASS_KEYS);
    const next  = fc.upcoming[0];
    const next2 = fc.upcoming[1];

    const ageInfo = fc.isModern
      ? `Current threshold: <b>${fc.active.multiplier}×</b> 2nd-place score
         ${next  ? ` → <b>${next.multiplier}×</b> at ${next.agePoints} pts` : ''}
         ${next2 ? ` → <b>${next2.multiplier}×</b> at ${next2.agePoints} pts` : ''}`
      : `⚠ Not in Modern Age — Modern thresholds shown for reference only`;

    // Table styles
    const ths = 'padding:4px 8px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.15);color:#8fa0b0;font-weight:normal;font-size:10px;white-space:nowrap;';
    const tds = 'padding:4px 8px;border-bottom:1px solid rgba(255,255,255,0.06);vertical-align:middle;font-size:11px;';
    const tdOnTrack = tds + 'background:rgba(40,110,50,0.3);';
    const badge = 'display:inline-block;margin-left:5px;padding:1px 5px;background:#1e5c28;color:#7dff88;font-size:9px;font-weight:bold;border-radius:3px;border:1px solid #3a9a48;white-space:nowrap;';

    const headerCols = labels.map(l => `<th style="${ths}">${l}</th>`).join('');
    const rows = [];

    for (const [, entry] of fc.players) {
      const nameTd = `<td style="${tds + (entry.isLocal ? 'color:#f6d56e;font-weight:bold;' : '')}">${entry.name}</td>`;
      const cols = labels.map(label => {
        const vt = entry.vtResults.get(label);
        if (!vt) return `<td style="${tds}">—</td>`;
        const rankStr  = vt.rank === 1 ? '🥇' : `#${vt.rank}`;
        const scoreStr = vt.score != null ? Math.round(vt.score) : '?';
        const onTrackBadge = vt.onTrack
          ? `<span style="${badge}">ON TRACK${vt.multiplier ? ` ×${vt.multiplier}` : ''}</span>`
          : '';
        return `<td style="${vt.onTrack ? tdOnTrack : tds}">
          <span style="font-size:9px;color:#6a7a8a;">${rankStr}</span>
          <span style="margin-left:4px;">${scoreStr}</span>
          ${onTrackBadge}
        </td>`;
      }).join('');
      rows.push(`<tr>${nameTd}${cols}</tr>`);
    }

    const legend = next
      ? `"ON TRACK ×M" = this player's score trajectory will meet the ×M threshold lowering
         (i.e. they'll be ≥ M × 2nd-place at ~${next.agePoints} pts${next2 ? ` or ~${next2.agePoints} pts` : ''}).
         Score rates estimated as current-score ÷ age-points-elapsed (linear projection).`
      : 'No upcoming threshold changes — Modern age is in its final phase.';

    return `
      <div style="color:#b8c4d0;font-size:11px;margin-bottom:10px;">${ageInfo}</div>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr>
          <th style="${ths}">Player</th>${headerCols}
        </tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
      <div style="color:#505a64;font-size:10px;margin-top:10px;line-height:1.4;">${legend}</div>
    `;
  }

  _refreshPopup() {
    const popup = this._popup;
    if (!popup || popup.style.display === 'none') return;
    const fc = this._computeForecast();
    const body = popup.querySelector('#vf-popup-body');
    if (body) body.innerHTML = this._renderBody(fc);
    const sub = popup.querySelector('#vf-popup-sub');
    if (sub) sub.textContent =
      `${MOD_VERSION_LABEL} · Age: ${fc.ageType ?? '?'} · ${fc.agePoints}/${fc.maxPts} pts`;
  }

  // ── POPUP LIFECYCLE ─────────────────────────────────────────────

  _ensurePopup() {
    if (this._popup && document.body?.contains(this._popup)) return this._popup;

    const popup = document.createElement('div');
    popup.id = VF_POPUP_ID;
    Object.assign(popup.style, {
      position:        'fixed',
      top:             '56px',
      right:           '20px',
      zIndex:          '99999',
      display:         'none',
      minWidth:        '520px',
      maxWidth:        '700px',
      maxHeight:       '72vh',
      overflowY:       'auto',
      padding:         '14px 16px',
      border:          '1px solid rgba(246,213,110,0.55)',
      borderRadius:    '8px',
      background:      'rgba(5,10,18,0.97)',
      color:           '#ffffff',
      fontFamily:      'Arial, sans-serif',
      fontSize:        '13px',
      lineHeight:      '1.45',
      boxShadow:       '0 4px 18px rgba(0,0,0,0.65)',
      pointerEvents:   'auto',
    });

    const fc = this._computeForecast();
    popup.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div style="font-size:15px;font-weight:bold;color:#f6d56e;">${MOD_DISPLAY_NAME}</div>
        <div id="vf-popup-close" role="button" aria-label="Close"
             style="cursor:pointer;color:#bbb;font-size:16px;line-height:1;padding:2px 8px;">&#x2715;</div>
      </div>
      <div id="vf-popup-sub" style="color:#b8c4d0;font-size:11px;margin-bottom:10px;">
        ${MOD_VERSION_LABEL} · Age: ${fc.ageType ?? '?'} · ${fc.agePoints}/${fc.maxPts} pts
      </div>
      <div id="vf-popup-body">${this._renderBody(fc)}</div>
    `;

    document.body.appendChild(popup);
    this._popup = popup;

    // Close button
    const closeBtn = popup.querySelector('#vf-popup-close');
    if (closeBtn) {
      const doClose = ev => { ev.stopPropagation(); this._setVisible(false); };
      closeBtn.addEventListener('click',      doClose);
      closeBtn.addEventListener('pointerdown', doClose);
    }

    // Outside-click dismissal
    if (!this._outsideClick) {
      this._outsideClick = ev => {
        if (!this._popup || this._popup.style.display === 'none') return;
        if (this._popup.contains(ev.target)) return;
        if (this._button?.contains(ev.target)) return;
        this._setVisible(false);
      };
      document.addEventListener('click', this._outsideClick, true);
    }

    return popup;
  }

  _setVisible(visible) {
    const popup = this._ensurePopup();
    popup.style.display = visible ? 'block' : 'none';
    if (visible) this._refreshPopup();
  }

  _togglePopup() {
    const popup = this._ensurePopup();
    this._setVisible(popup.style.display === 'none');
  }

  // ── BUTTON INJECTION ────────────────────────────────────────────

  _scheduleInjection() {
    const tryInject = () => {
      if (this._button && document.body?.contains(this._button)) return;

      // Preferred anchor: turn-number parent (same as zoom mod).
      const turnEl = document.querySelector('.ps-turn-number, [class*="turn-number"]');
      if (turnEl?.parentElement) {
        this._injectButton(turnEl.parentElement, turnEl);
        return;
      }

      // Fallback: ps-icons group.
      const icons = document.querySelector(TOP_BAR_ANCHOR);
      if (icons) {
        this._injectButton(icons, icons.firstChild);
        return;
      }

      this._injectTries++;
      if (this._injectTries >= INJECT_MAX_TRIES) {
        if (document.body) {
          const btn = this._buildButton(true);
          document.body.appendChild(btn);
          this._button = btn;
          vfLog('button injected (full fallback)');
        }
        return;
      }
      setTimeout(tryInject, INJECT_INTERVAL);
    };
    tryInject();
  }

  _injectButton(anchor, insertBefore) {
    if (this._button && document.body?.contains(this._button)) return;
    const btn = this._buildButton(false);
    if (insertBefore && anchor.contains(insertBefore)) {
      anchor.insertBefore(btn, insertBefore);
    } else {
      anchor.appendChild(btn);
    }
    this._button = btn;
    vfLog('button injected');
  }

  _buildButton(isFallback) {
    const btn = document.createElement('div');
    btn.id = VF_BUTTON_ID;
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', `${MOD_DISPLAY_NAME} — victory track forecast`);
    btn.title = `${MOD_DISPLAY_NAME} — who's on victory track?`;
    btn.textContent = 'VF';

    Object.assign(btn.style, {
      cursor:          'pointer',
      userSelect:      'none',
      pointerEvents:   'auto',
      display:         'inline-block',
      alignSelf:       'center',
      boxSizing:       'border-box',
      width:           '38px',
      height:          '26px',
      padding:         '0',
      marginRight:     '14px',
      border:          '1px solid rgba(200,210,220,0.35)',
      borderRadius:    '4px',
      background:      'rgba(10,18,30,0.45)',
      color:           '#c8ced4',
      fontFamily:      'Arial, sans-serif',
      fontSize:        '12px',
      fontWeight:      'bold',
      letterSpacing:   '0.5px',
      lineHeight:      '24px',
      textAlign:       'center',
      verticalAlign:   'middle',
    });

    if (isFallback) {
      Object.assign(btn.style, {
        position: 'fixed',
        top:      '12px',
        left:     '200px',
        zIndex:   '9998',
      });
    }

    btn.addEventListener('mouseenter', () => {
      btn.style.background   = 'rgba(40,60,90,0.75)';
      btn.style.color        = '#ffffff';
      btn.style.borderColor  = 'rgba(255,255,255,0.55)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background   = 'rgba(10,18,30,0.45)';
      btn.style.color        = '#c8ced4';
      btn.style.borderColor  = 'rgba(200,210,220,0.35)';
    });
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      this._togglePopup();
    });

    return btn;
  }
}

// ── BOOT ───────────────────────────────────────────────────────────

const VictoryForecaster = VFController.getInstance();
export { VictoryForecaster as default };

//# sourceMappingURL=victory-forecaster.js.map
