// Logika Utama Aplikasi Web KREYNTIX 2026 Mobile Legends: Bang Bang

import { TOURNAMENT_INFO, BRACKET_MATCHES, MATCH_BY_ID, ROUND_LABELS } from './bracket-data.js';
import { TEAMS_DATA } from './teams-data.js';
import { TOURNAMENT_RULES } from './rules-data.js';

// State Aplikasi
let tournamentResults = {};
let isAdminAuthenticated = false;
let isFirebaseConnected = false;
let activeSearchQuery = '';
let activeScheduleDay = 1;
let currentTheme = localStorage.getItem('kreyntix_theme') || 'dark';
let activeStreamController = null;

const STORAGE_KEYS = {
  RESULTS: 'kreyntix2026_results',
  THEME: 'kreyntix_theme'
};

// ==========================================================================
// INISIALISASI APLIKASI
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(currentTheme);
  loadCachedResults();
  setupEventListeners();
  checkUrlHashForState();
  renderAllViews();
  initializeFirebaseStream();
});

// ==========================================================================
// RESOLUSI TIM DALAM SLOT PERTANDINGAN
// ==========================================================================
function resolveMatchSlot(slotDefinition, resultsMap) {
  if (typeof slotDefinition === 'string') {
    return { name: slotDefinition, isKnown: true, isBye: false };
  }

  if (slotDefinition && slotDefinition.w) {
    const winnerTeam = resultsMap[slotDefinition.w];
    if (winnerTeam) {
      return { name: winnerTeam, isKnown: true, isBye: false };
    }
    return { name: `Pemenang ${slotDefinition.w}`, isKnown: false, isBye: false };
  }

  if (slotDefinition && slotDefinition.l) {
    const parentMatch = MATCH_BY_ID[slotDefinition.l];
    const parentWinner = resultsMap[slotDefinition.l];
    if (!parentWinner || !parentMatch) {
      return { name: `Kalah ${slotDefinition.l}`, isKnown: false, isBye: false };
    }
    const teamA = resolveMatchSlot(parentMatch.s0, resultsMap);
    const teamB = resolveMatchSlot(parentMatch.s1, resultsMap);
    const loser = [teamA, teamB].find(item => item.isKnown && item.name !== parentWinner);
    if (loser) {
      return { name: loser.name, isKnown: true, isBye: false };
    }
    return { name: `Kalah ${slotDefinition.l}`, isKnown: false, isBye: false };
  }

  return { name: 'Menunggu Hasil', isKnown: false, isBye: false };
}

// ==========================================================================
// FIREBASE REALTIME SYNC (SSE STREAM & REST API)
// ==========================================================================
function getFirebaseEndpoint(path = '') {
  const base = TOURNAMENT_INFO.firebaseDatabaseUrl.replace(/\/$/, '');
  return `${base}/${path}.json`;
}

async function initializeFirebaseStream() {
  if (!TOURNAMENT_INFO.firebaseDatabaseUrl) return;

  if (activeStreamController) {
    activeStreamController.abort();
  }
  activeStreamController = new AbortController();

  updateSyncIndicator(false, 'Menghubungkan');

  try {
    const response = await fetch(getFirebaseEndpoint('results'), {
      headers: { Accept: 'text/event-stream' },
      signal: activeStreamController.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    isFirebaseConnected = true;
    updateSyncIndicator(true, 'Live Realtime');

    const streamReader = response.body.getReader();
    const textDecoder = new TextDecoder();
    let streamBuffer = '';

    while (true) {
      const { done, value } = await streamReader.read();
      if (done) break;

      streamBuffer += textDecoder.decode(value, { stream: true });
      const messageLines = streamBuffer.split('\n');
      streamBuffer = messageLines.pop();

      let streamEvent = '';
      for (const line of messageLines) {
        if (line.startsWith('event: ')) {
          streamEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ') && (streamEvent === 'put' || streamEvent === 'patch')) {
          try {
            const streamPayload = JSON.parse(line.slice(6));
            if (streamPayload && streamPayload.path === '/') {
              tournamentResults = streamPayload.data || {};
              persistCachedResults();
              renderAllViews();
            } else if (streamPayload && streamPayload.path && streamPayload.path.startsWith('/')) {
              const matchKey = streamPayload.path.slice(1);
              if (streamPayload.data === null) {
                delete tournamentResults[matchKey];
              } else {
                tournamentResults[matchKey] = streamPayload.data;
              }
              persistCachedResults();
              renderAllViews();
            }
          } catch (jsonError) {
            // Buffer parsing
          }
          streamEvent = '';
        }
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') return;
    isFirebaseConnected = false;
    updateSyncIndicator(false, 'Mode Offline');
    setTimeout(initializeFirebaseStream, 6000);
  }
}

async function writeMatchResultToFirebase(matchId, winningTeamName) {
  if (!TOURNAMENT_INFO.firebaseDatabaseUrl) return false;
  try {
    if (winningTeamName === null) {
      await fetch(getFirebaseEndpoint(`results/${matchId}`), {
        method: 'DELETE'
      });
    } else {
      await fetch(getFirebaseEndpoint(`results/${matchId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(winningTeamName)
      });
    }
    return true;
  } catch (err) {
    return false;
  }
}

function updateSyncIndicator(isConnected, statusLabel) {
  const indicator = document.getElementById('live-indicator');
  if (!indicator) return;

  const statusText = indicator.querySelector('.status-text');
  if (statusText) statusText.textContent = statusLabel;

  if (isConnected) {
    indicator.classList.add('live-active');
  } else {
    indicator.classList.remove('live-active');
  }
}

// ==========================================================================
// CACHE LOKAL & SHARING
// ==========================================================================
function loadCachedResults() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.RESULTS);
    if (raw) {
      tournamentResults = JSON.parse(raw);
    }
  } catch (e) {
    tournamentResults = {};
  }
}

function persistCachedResults() {
  try {
    localStorage.setItem(STORAGE_KEYS.RESULTS, JSON.stringify(tournamentResults));
  } catch (e) {
    // Local storage error handling
  }
}

function checkUrlHashForState() {
  const hash = window.location.hash.slice(1);
  if (hash.startsWith('s=')) {
    try {
      const decoded = atob(decodeURIComponent(hash.slice(2)));
      tournamentResults = JSON.parse(decoded);
      persistCachedResults();
      showToast('Bagan dimuat dari tautan bagikan');
    } catch (err) {
      // Invalid hash
    }
  }
}

// ==========================================================================
// RENDERING VIEW UTAMA
// ==========================================================================
function renderAllViews() {
  updateMetricsDisplay();
  renderVisualBracketTree();
  renderScheduleView();
  renderTeamsDirectory();
  renderRulesAccordion();
  renderStreamMatchesList();
}

function updateMetricsDisplay() {
  const completedCount = Object.keys(tournamentResults).length;
  const completedElement = document.getElementById('stat-completed-matches');
  if (completedElement) {
    completedElement.textContent = `${completedCount} / 58`;
  }
}

// ==========================================================================
// TAB 1: VISUAL BRACKET TREE
// ==========================================================================
function renderVisualBracketTree() {
  const canvas = document.getElementById('bracket-canvas');
  if (!canvas) return;

  const roundsConfig = [
    { title: 'Round 1 (26 Match)', matches: BRACKET_MATCHES.filter(m => m.round === 'Round 1') },
    { title: 'Round of 32 (16 Match)', matches: BRACKET_MATCHES.filter(m => m.round === 'Round of 32') },
    { title: 'Round of 16 (8 Match)', matches: BRACKET_MATCHES.filter(m => m.round === 'Round of 16') },
    { title: 'Quarterfinal (4 Match)', matches: BRACKET_MATCHES.filter(m => m.round === 'Quarterfinal') },
    { title: 'Semifinal (BO3)', matches: BRACKET_MATCHES.filter(m => m.round === 'Semifinal') },
    { title: 'Finals (Juara 3 & GF)', matches: BRACKET_MATCHES.filter(m => m.round === 'Perebutan Juara 3' || m.round === 'Grand Final') }
  ];

  let htmlContent = '';

  roundsConfig.forEach(column => {
    htmlContent += `
      <div class="bracket-round-column">
        <div class="round-column-header">
          <div class="round-col-title">${column.title}</div>
          <div class="round-col-meta">${column.matches.length} Laga Terjadwal</div>
        </div>
        <div class="round-matches-stack">
          ${column.matches.map(matchItem => createBracketNodeMarkup(matchItem)).join('')}
        </div>
      </div>
    `;
  });

  canvas.innerHTML = htmlContent;
}

function createBracketNodeMarkup(matchItem) {
  const currentWinner = tournamentResults[matchItem.id] || null;
  const slotZero = resolveMatchSlot(matchItem.s0, tournamentResults);
  const slotOne = resolveMatchSlot(matchItem.s1, tournamentResults);

  const isMatchedSearch = isMatchHighlightedBySearch(slotZero.name, slotOne.name);
  const isStreamMatch = Boolean(matchItem.stream);

  return `
    <div class="bracket-match-node ${isMatchedSearch ? 'highlighted' : ''} ${isStreamMatch ? 'stream-node' : ''}" 
         onclick="openMatchDetailModal('${matchItem.id}')" 
         id="bracket-node-${matchItem.id}">
      <div class="node-meta-row">
        <span class="node-id">${matchItem.id}</span>
        ${matchItem.bye ? '<span class="node-bye-tag">BYE</span>' : ''}
        ${isStreamMatch ? '<span class="node-stream-tag">STREAM</span>' : ''}
        <span class="node-time">${matchItem.time} WIB</span>
      </div>
      <div class="node-slots">
        <div class="node-slot ${getSlotClass(slotZero.name, slotZero.isKnown, currentWinner)}">
          <span class="slot-name">${slotZero.name}</span>
          ${currentWinner === slotZero.name ? '<span class="slot-status-mark">[MENANG]</span>' : ''}
        </div>
        <div class="node-slot ${getSlotClass(slotOne.name, slotOne.isKnown, currentWinner)}">
          <span class="slot-name">${slotOne.name}</span>
          ${currentWinner === slotOne.name ? '<span class="slot-status-mark">[MENANG]</span>' : ''}
        </div>
      </div>
    </div>
  `;
}

function getSlotClass(teamName, isKnown, winnerTeam) {
  if (!isKnown) return 'tbd';
  if (winnerTeam === teamName) return 'win';
  if (winnerTeam && winnerTeam !== teamName) return 'loss';
  return '';
}

function isMatchHighlightedBySearch(nameA, nameB) {
  if (!activeSearchQuery) return false;
  const query = activeSearchQuery.toLowerCase();
  return nameA.toLowerCase().includes(query) || nameB.toLowerCase().includes(query);
}

// ==========================================================================
// TAB 2: RUNDOWN JADWAL PER HARI
// ==========================================================================
function renderScheduleView() {
  const panelDay1 = document.getElementById('schedule-day-1');
  const panelDay2 = document.getElementById('schedule-day-2');
  const panelDay3 = document.getElementById('schedule-day-3');

  if (panelDay1) {
    panelDay1.innerHTML = `
      <div class="timeline-summary-bar">
        <div class="timeline-step"><span class="step-time">18.30</span> R1 Kloter 1 (13 Laga)</div>
        <div class="timeline-step"><span class="step-time">18.45</span> R1 Kloter 2 (13 Laga)</div>
        <div class="timeline-step"><span class="step-time">19.25</span> R32 Kloter 1 (8 Laga)</div>
        <div class="timeline-step"><span class="step-time">19.40</span> R32 Kloter 2 (8 Laga)</div>
        <div class="timeline-step"><span class="step-time">20.20</span> Round of 16 (8 Laga)</div>
        <div class="timeline-step"><span class="step-time">21.00</span> Quarterfinal (4 Laga)</div>
      </div>
      ${renderRoundAccordion('Round 1', 'Babak 1 Kualifikasi', '18.30 - 19.15 WIB', BRACKET_MATCHES.filter(m => m.round === 'Round 1'), true, true)}
      ${renderRoundAccordion('Round of 32', 'Babak 32 Besar (Termasuk Tim Seeded BYE)', '19.25 - 20.10 WIB', BRACKET_MATCHES.filter(m => m.round === 'Round of 32'), true, false)}
      ${renderRoundAccordion('Round of 16', 'Babak 16 Besar', '20.20 - 20.50 WIB', BRACKET_MATCHES.filter(m => m.round === 'Round of 16'), false, false)}
      ${renderRoundAccordion('Quarterfinal', 'Babak Perempat Final', '21.00 - 21.30 WIB', BRACKET_MATCHES.filter(m => m.round === 'Quarterfinal'), false, false)}
    `;
  }

  if (panelDay2) {
    panelDay2.innerHTML = `
      <div class="timeline-summary-bar">
        <div class="timeline-step"><span class="step-time">18.30</span> Semifinal 1 (BO3 - Live Stream)</div>
        <div class="timeline-step"><span class="step-time">19.45</span> Semifinal 2 (BO3 - Live Stream)</div>
        <div class="timeline-step"><span class="step-time">~21.00</span> Penutupan Day 2</div>
      </div>
      ${renderRoundAccordion('Semifinal', 'Babak Semifinal Resmi (BO3)', '18.30 - 21.00 WIB', BRACKET_MATCHES.filter(m => m.round === 'Semifinal'), false, true)}
    `;
  }

  if (panelDay3) {
    panelDay3.innerHTML = `
      <div class="timeline-summary-bar">
        <div class="timeline-step"><span class="step-time">18.30</span> Perebutan Juara 3 (BO3 - Live Stream)</div>
        <div class="timeline-step"><span class="step-time">19.45</span> Grand Final Championship (BO5 - Live Stream)</div>
        <div class="timeline-step"><span class="step-time">~21.45</span> Penyerahan Apresiasi & Juara</div>
      </div>
      ${renderRoundAccordion('Finals', 'Championship Final Day (BO3 & BO5)', '18.30 - 21.45 WIB', BRACKET_MATCHES.filter(m => m.round === 'Perebutan Juara 3' || m.round === 'Grand Final'), false, true)}
    `;
  }
}

function renderRoundAccordion(roundKey, roundTitle, timeRange, matchesList, hasKloter, isDefaultOpen) {
  let innerBodyHtml = '';

  if (hasKloter) {
    const kloterOneMatches = matchesList.filter(m => m.kloter === 1);
    const kloterTwoMatches = matchesList.filter(m => m.kloter === 2);

    innerBodyHtml = `
      <div class="kloter-divider">Kloter 1 — Dimulai 18.30 / 19.25 WIB (${kloterOneMatches.length} Pertandingan)</div>
      <div class="matches-grid">
        ${kloterOneMatches.map(renderScheduleCard).join('')}
      </div>
      <div class="kloter-divider">Kloter 2 — Dimulai 18.45 / 19.40 WIB (${kloterTwoMatches.length} Pertandingan)</div>
      <div class="matches-grid">
        ${kloterTwoMatches.map(renderScheduleCard).join('')}
      </div>
    `;
  } else {
    innerBodyHtml = `
      <div class="matches-grid">
        ${matchesList.map(renderScheduleCard).join('')}
      </div>
    `;
  }

  return `
    <div class="stage-accordion-block ${isDefaultOpen ? 'open' : ''}">
      <div class="stage-header" onclick="toggleStageAccordion(this)">
        <div class="stage-title-wrap">
          <span class="stage-title">${roundTitle}</span>
          <div class="stage-badges">
            <span class="stage-badge">${matchesList.length} Match</span>
            <span class="stage-time-range">${timeRange}</span>
          </div>
        </div>
        <div class="stage-toggle-icon">▼</div>
      </div>
      <div class="stage-body">
        ${innerBodyHtml}
      </div>
    </div>
  `;
}

function renderScheduleCard(matchItem) {
  const currentWinner = tournamentResults[matchItem.id] || null;
  const slotZero = resolveMatchSlot(matchItem.s0, tournamentResults);
  const slotOne = resolveMatchSlot(matchItem.s1, tournamentResults);
  const isSearchMatched = isMatchHighlightedBySearch(slotZero.name, slotOne.name);

  const nextDestination = matchItem.next ? matchItem.next.m : 'Selesai';

  return `
    <div class="schedule-match-card ${isSearchMatched ? 'highlighted' : ''}" 
         onclick="openMatchDetailModal('${matchItem.id}')"
         id="sched-card-${matchItem.id}">
      <div class="card-top-row">
        <span class="card-match-id">${matchItem.id} · ${matchItem.round}</span>
        <span class="card-time-badge">${matchItem.time} WIB</span>
      </div>

      <div class="card-teams-wrap">
        <div class="card-team-slot ${getSlotClass(slotZero.name, slotZero.isKnown, currentWinner)} ${isAdminAuthenticated && slotZero.isKnown ? 'clickable' : ''}"
             ${isAdminAuthenticated && slotZero.isKnown ? `onclick="handleDirectAdminWinnerSelect(event, '${matchItem.id}', '${escapeQuotes(slotZero.name)}')"` : ''}>
          <span class="slot-name">${slotZero.name}</span>
          ${currentWinner === slotZero.name ? '<span class="slot-status-mark">[MENANG]</span>' : ''}
        </div>

        <div class="card-team-slot ${getSlotClass(slotOne.name, slotOne.isKnown, currentWinner)} ${isAdminAuthenticated && slotOne.isKnown ? 'clickable' : ''}"
             ${isAdminAuthenticated && slotOne.isKnown ? `onclick="handleDirectAdminWinnerSelect(event, '${matchItem.id}', '${escapeQuotes(slotOne.name)}')"` : ''}>
          <span class="slot-name">${slotOne.name}</span>
          ${currentWinner === slotOne.name ? '<span class="slot-status-mark">[MENANG]</span>' : ''}
        </div>
      </div>

      <div class="card-footer-info">
        <span class="next-advance-label">Lolos ke ${nextDestination}</span>
        <span class="card-format-tag">${matchItem.format}</span>
      </div>
    </div>
  `;
}

// ==========================================================================
// TAB 3: DIREKTORI 58 TIM
// ==========================================================================
function renderTeamsDirectory() {
  const container = document.getElementById('teams-grid-container');
  if (!container) return;

  const filterSelect = document.getElementById('team-status-filter');
  const selectedFilter = filterSelect ? filterSelect.value : 'all';

  let filteredTeams = TEAMS_DATA;

  if (activeSearchQuery) {
    const q = activeSearchQuery.toLowerCase();
    filteredTeams = filteredTeams.filter(t => t.name.toLowerCase().includes(q));
  }

  if (selectedFilter === 'bye') {
    filteredTeams = filteredTeams.filter(t => t.hasBye);
  } else if (selectedFilter === 'eliminated') {
    filteredTeams = filteredTeams.filter(t => isTeamEliminated(t.name));
  } else if (selectedFilter === 'active') {
    filteredTeams = filteredTeams.filter(t => !isTeamEliminated(t.name));
  }

  if (filteredTeams.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; padding: 32px; text-align: center; color: var(--text-dim);">Tidak ada tim yang cocok dengan kriteria pencarian.</div>`;
    return;
  }

  container.innerHTML = filteredTeams.map(teamRecord => {
    const entryMatch = MATCH_BY_ID[teamRecord.entryMatch];
    const isEliminated = isTeamEliminated(teamRecord.name);

    return `
      <div class="team-card">
        <div class="team-card-header">
          <span class="team-seed-badge ${teamRecord.hasBye ? 'bye' : ''}">${teamRecord.seedStatus}</span>
          <span style="font-size: 0.72rem; font-family: var(--font-mono); color: var(--text-dim);">${teamRecord.id}</span>
        </div>
        <div class="team-name">${teamRecord.name}</div>
        <div class="team-details-list">
          <div class="team-detail-item">
            <span>Babak Pembuka:</span>
            <span class="team-detail-val">${teamRecord.initialRound}</span>
          </div>
          <div class="team-detail-item">
            <span>Laga Pertama:</span>
            <span class="team-detail-val">${teamRecord.entryMatch} (${entryMatch ? entryMatch.time : '-'} WIB)</span>
          </div>
          <div class="team-detail-item">
            <span>Status Tim:</span>
            <span class="team-detail-val" style="color: ${isEliminated ? 'var(--color-error)' : 'var(--color-win)'};">
              ${isEliminated ? 'Tereliminasi' : 'Aktif / Bertanding'}
            </span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function isTeamEliminated(teamName) {
  for (const matchId in tournamentResults) {
    const winner = tournamentResults[matchId];
    const match = MATCH_BY_ID[matchId];
    if (!match) continue;
    const s0 = resolveMatchSlot(match.s0, tournamentResults);
    const s1 = resolveMatchSlot(match.s1, tournamentResults);

    if ((s0.name === teamName || s1.name === teamName) && winner !== teamName) {
      // In Semifinal (M55, M56), the loser plays in M57 (Bronze match)
      if (matchId === 'M55' || matchId === 'M56') {
        const bronzeWinner = tournamentResults['M57'];
        if (bronzeWinner && bronzeWinner !== teamName) {
          return true;
        }
        return false;
      }
      return true;
    }
  }
  return false;
}

// ==========================================================================
// TAB 4: REGULASI & RULES
// ==========================================================================
function renderRulesAccordion() {
  const container = document.getElementById('rules-accordion');
  if (!container) return;

  const searchInput = document.getElementById('rules-search-input');
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  let chaptersList = TOURNAMENT_RULES;

  if (query) {
    chaptersList = chaptersList.map(chapter => {
      const filteredItems = chapter.items.filter(item => 
        item.title.toLowerCase().includes(query) || 
        item.text.toLowerCase().includes(query) ||
        chapter.title.toLowerCase().includes(query)
      );
      return { ...chapter, items: filteredItems };
    }).filter(chapter => chapter.items.length > 0);
  }

  if (chaptersList.length === 0) {
    container.innerHTML = `<div style="padding: 32px; text-align: center; color: var(--text-dim);">Tidak ditemukan pasal atau regulasi yang sesuai kata kunci.</div>`;
    return;
  }

  container.innerHTML = chaptersList.map((chapter, index) => {
    return `
      <div class="rule-chapter-card ${index === 0 || query ? 'open' : ''}">
        <div class="rule-chapter-header" onclick="toggleRuleChapter(this)">
          <div class="rule-chapter-title-group">
            <span class="rule-chapter-num">${chapter.chapter}</span>
            <span class="rule-chapter-title">${chapter.title}</span>
            <span class="rule-chapter-summary">${chapter.summary}</span>
          </div>
          <div class="stage-toggle-icon">▼</div>
        </div>
        <div class="rule-chapter-body">
          <div class="rule-items-stack">
            ${chapter.items.map(item => `
              <div class="rule-single-item">
                <div class="rule-item-headline">
                  <span class="rule-item-number">${item.number}</span>
                  <span class="rule-item-title">${item.title}</span>
                </div>
                <div class="rule-item-text">${item.text}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ==========================================================================
// TAB 5: STREAM MATCHES LIST
// ==========================================================================
function renderStreamMatchesList() {
  const container = document.getElementById('stream-matches-list');
  if (!container) return;

  const streamMatches = BRACKET_MATCHES.filter(m => m.stream);

  container.innerHTML = streamMatches.map(matchItem => {
    const currentWinner = tournamentResults[matchItem.id] || null;
    const s0 = resolveMatchSlot(matchItem.s0, tournamentResults);
    const s1 = resolveMatchSlot(matchItem.s1, tournamentResults);

    return `
      <div class="stream-match-item" onclick="openMatchDetailModal('${matchItem.id}')" style="cursor: pointer;">
        <div class="card-top-row" style="margin-bottom: 6px;">
          <span style="font-family: var(--font-display); font-weight: 800; color: var(--color-stream);">${matchItem.round} (${matchItem.format})</span>
          <span style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-dim);">${matchItem.date} · ${matchItem.time} WIB</span>
        </div>
        <div class="card-teams-wrap">
          <div class="card-team-slot ${getSlotClass(s0.name, s0.isKnown, currentWinner)}">
            <span class="slot-name">${s0.name}</span>
            ${currentWinner === s0.name ? '<span class="slot-status-mark">[MENANG]</span>' : ''}
          </div>
          <div class="card-team-slot ${getSlotClass(s1.name, s1.isKnown, currentWinner)}">
            <span class="slot-name">${s1.name}</span>
            ${currentWinner === s1.name ? '<span class="slot-status-mark">[MENANG]</span>' : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ==========================================================================
// INTERAKSI & MODALS
// ==========================================================================
window.openMatchDetailModal = function(matchId) {
  const match = MATCH_BY_ID[matchId];
  if (!match) return;

  const currentWinner = tournamentResults[matchId] || null;
  const s0 = resolveMatchSlot(match.s0, tournamentResults);
  const s1 = resolveMatchSlot(match.s1, tournamentResults);

  const modal = document.getElementById('modal-match-detail');
  const title = document.getElementById('modal-match-title');
  const eyebrow = document.getElementById('modal-match-eyebrow');
  const body = document.getElementById('modal-match-body');

  eyebrow.textContent = `${match.round} · ${match.format}`;
  title.textContent = `Match ${match.id.slice(1)} (${match.id})`;

  const nextLabel = match.next ? `Pemenang melaju ke ${match.next.m}` : 'Penentuan Juara';
  const loserLabel = match.nextLoser ? `Kalah bertanding di ${match.nextLoser.m}` : '';

  body.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 14px;">
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.8rem; background: var(--bg-surface-elevated); padding: 10px; border-radius: var(--radius-sm);">
        <div><strong>Jadwal:</strong> ${match.date}, ${match.time} WIB</div>
        <div><strong>Kloter:</strong> ${match.kloter ? `Kloter ${match.kloter}` : 'Reguler'}</div>
        <div><strong>Format:</strong> ${match.format} (Custom Draft Pick)</div>
        <div><strong>Status Siaran:</strong> ${match.stream ? 'Official Stream' : 'Reguler'}</div>
      </div>

      <div style="font-weight: 700; font-size: 0.85rem; color: var(--text-muted);">Pilih Pemenang (Mode Wasit / Admin):</div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <button class="primary-btn" 
                style="text-align: left; display: flex; justify-content: space-between; align-items: center; background: ${currentWinner === s0.name ? 'var(--color-win)' : 'var(--bg-surface-elevated)'}; color: ${currentWinner === s0.name ? '#ffffff' : 'var(--text-main)'}; border: 1px solid var(--border-subtle);"
                ${!isAdminAuthenticated || !s0.isKnown ? 'disabled style="opacity:0.6; cursor:not-allowed;"' : ''}
                onclick="setMatchWinner('${match.id}', '${escapeQuotes(s0.name)}')">
          <span>${s0.name}</span>
          ${currentWinner === s0.name ? '<span>[PEMENANG]</span>' : (isAdminAuthenticated && s0.isKnown ? '<span>Tentukan Menang</span>' : '')}
        </button>

        <button class="primary-btn" 
                style="text-align: left; display: flex; justify-content: space-between; align-items: center; background: ${currentWinner === s1.name ? 'var(--color-win)' : 'var(--bg-surface-elevated)'}; color: ${currentWinner === s1.name ? '#ffffff' : 'var(--text-main)'}; border: 1px solid var(--border-subtle);"
                ${!isAdminAuthenticated || !s1.isKnown ? 'disabled style="opacity:0.6; cursor:not-allowed;"' : ''}
                onclick="setMatchWinner('${match.id}', '${escapeQuotes(s1.name)}')">
          <span>${s1.name}</span>
          ${currentWinner === s1.name ? '<span>[PEMENANG]</span>' : (isAdminAuthenticated && s1.isKnown ? '<span>Tentukan Menang</span>' : '')}
        </button>
      </div>

      ${isAdminAuthenticated && currentWinner ? `
        <button class="secondary-btn" style="color: var(--color-error); border-color: var(--color-error-subtle);" onclick="setMatchWinner('${match.id}', null)">
          Hapus / Reset Pemenang Pertandingan
        </button>
      ` : ''}

      <div style="font-size: 0.78rem; color: var(--text-dim); border-top: 1px solid var(--border-subtle); padding-top: 8px;">
        <div>${nextLabel}</div>
        ${loserLabel ? `<div>${loserLabel}</div>` : ''}
      </div>
    </div>
  `;

  modal.classList.add('open');
};

window.closeMatchModal = function() {
  const modal = document.getElementById('modal-match-detail');
  if (modal) modal.classList.remove('open');
};

window.openAdminModal = function() {
  const modal = document.getElementById('modal-admin-login');
  if (modal) {
    modal.classList.add('open');
    setTimeout(() => {
      const input = document.getElementById('admin-password-input');
      if (input) input.focus();
    }, 100);
  }
};

window.closeAdminModal = function() {
  const modal = document.getElementById('modal-admin-login');
  if (modal) modal.classList.remove('open');
};

window.toggleStageAccordion = function(headerElement) {
  const parent = headerElement.closest('.stage-accordion-block');
  if (parent) parent.classList.toggle('open');
};

window.toggleRuleChapter = function(headerElement) {
  const parent = headerElement.closest('.rule-chapter-card');
  if (parent) parent.classList.toggle('open');
};

window.handleDirectAdminWinnerSelect = function(event, matchId, teamName) {
  event.stopPropagation();
  if (!isAdminAuthenticated) return;
  setMatchWinner(matchId, teamName);
};

window.setMatchWinner = async function(matchId, selectedTeam) {
  if (!isAdminAuthenticated) {
    showToast('Masuk sebagai admin terlebih dahulu untuk mengubah hasil');
    return;
  }

  const currentWinner = tournamentResults[matchId];
  const newWinner = currentWinner === selectedTeam ? null : selectedTeam;

  if (newWinner === null) {
    delete tournamentResults[matchId];
  } else {
    tournamentResults[matchId] = newWinner;
  }

  persistCachedResults();
  renderAllViews();
  closeMatchModal();

  showToast(newWinner ? `${newWinner} ditetapkan sebagai pemenang ${matchId}` : `Hasil ${matchId} direset`);

  if (isFirebaseConnected) {
    const success = await writeMatchResultToFirebase(matchId, newWinner);
    if (!success) {
      showToast('Gagal sinkronisasi ke Firebase RTDB');
    }
  }
};

// ==========================================================================
// TEMA & NAVIGASI
// ==========================================================================
function applyTheme(themeName) {
  currentTheme = themeName;
  document.documentElement.setAttribute('data-theme', themeName);
  localStorage.setItem(STORAGE_KEYS.THEME, themeName);

  const sunIcon = document.getElementById('theme-icon-sun');
  const moonIcon = document.getElementById('theme-icon-moon');

  if (sunIcon && moonIcon) {
    if (themeName === 'light') {
      sunIcon.classList.add('hidden');
      moonIcon.classList.remove('hidden');
    } else {
      sunIcon.classList.remove('hidden');
      moonIcon.classList.add('hidden');
    }
  }
}

function toggleTheme() {
  const targetTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(targetTheme);
}

window.switchMainTab = function(tabId) {
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === tabId);
  });
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });
  window.scrollTo({ top: 320, behavior: 'smooth' });
};

// ==========================================================================
// EVENT LISTENERS & SETUP
// ==========================================================================
function setupEventListeners() {
  // Theme Toggle
  const themeBtn = document.getElementById('theme-toggle-btn');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

  // Main Nav Tabs
  document.querySelectorAll('.nav-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      const targetId = tabBtn.getAttribute('data-tab');
      document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tabBtn.classList.add('active');
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) targetPanel.classList.add('active');
    });
  });

  // Day Switcher for Schedule
  document.querySelectorAll('.day-tab-btn').forEach(dayBtn => {
    dayBtn.addEventListener('click', () => {
      const selectedDay = parseInt(dayBtn.getAttribute('data-day'), 10);
      activeScheduleDay = selectedDay;
      document.querySelectorAll('.day-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.schedule-day-panel').forEach(p => p.classList.remove('active'));
      dayBtn.classList.add('active');
      const targetDayPanel = document.getElementById(`schedule-day-${selectedDay}`);
      if (targetDayPanel) targetDayPanel.classList.add('active');
    });
  });

  // Global Search
  const globalSearchInput = document.getElementById('global-search-input');
  const clearSearchBtn = document.getElementById('clear-search-btn');
  const searchPill = document.getElementById('search-active-pill');
  const searchQueryDisplay = document.getElementById('search-query-display');
  const resetFilterLink = document.getElementById('reset-filter-link');

  if (globalSearchInput) {
    globalSearchInput.addEventListener('input', e => {
      activeSearchQuery = e.target.value.trim();
      if (activeSearchQuery) {
        clearSearchBtn.classList.remove('hidden');
        searchPill.classList.remove('hidden');
        searchQueryDisplay.textContent = activeSearchQuery;
      } else {
        clearSearchBtn.classList.add('hidden');
        searchPill.classList.add('hidden');
      }
      renderAllViews();
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      if (globalSearchInput) globalSearchInput.value = '';
      activeSearchQuery = '';
      clearSearchBtn.classList.add('hidden');
      searchPill.classList.add('hidden');
      renderAllViews();
    });
  }

  if (resetFilterLink) {
    resetFilterLink.addEventListener('click', () => {
      if (globalSearchInput) globalSearchInput.value = '';
      activeSearchQuery = '';
      clearSearchBtn.classList.add('hidden');
      searchPill.classList.add('hidden');
      renderAllViews();
    });
  }

  // Rules search input
  const rulesSearchInput = document.getElementById('rules-search-input');
  if (rulesSearchInput) {
    rulesSearchInput.addEventListener('input', () => {
      renderRulesAccordion();
    });
  }

  // Team Filter Select
  const teamFilterSelect = document.getElementById('team-status-filter');
  if (teamFilterSelect) {
    teamFilterSelect.addEventListener('change', () => {
      renderTeamsDirectory();
    });
  }

  // Admin Triggers
  const adminTriggerBtn = document.getElementById('admin-trigger-btn');
  const floatingAdminBtn = document.getElementById('floating-admin-btn');
  const adminLoginSubmitBtn = document.getElementById('admin-login-submit-btn');
  const adminPasswordInput = document.getElementById('admin-password-input');

  const handleAdminClick = () => {
    if (isAdminAuthenticated) {
      isAdminAuthenticated = false;
      updateAdminButtonState();
      renderAllViews();
      showToast('Mode admin dinonaktifkan');
    } else {
      openAdminModal();
    }
  };

  if (adminTriggerBtn) adminTriggerBtn.addEventListener('click', handleAdminClick);
  if (floatingAdminBtn) floatingAdminBtn.addEventListener('click', handleAdminClick);

  if (adminLoginSubmitBtn) {
    adminLoginSubmitBtn.addEventListener('click', attemptAdminLogin);
  }

  if (adminPasswordInput) {
    adminPasswordInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') attemptAdminLogin();
    });
  }

  // Floating Share Button
  const shareBtn = document.getElementById('floating-share-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', shareBracketUrl);
  }

  // Reset Zoom Button
  const resetZoomBtn = document.getElementById('bracket-reset-zoom');
  if (resetZoomBtn) {
    resetZoomBtn.addEventListener('click', () => {
      const scrollArea = document.getElementById('bracket-scroll-area');
      if (scrollArea) {
        scrollArea.scrollTo({ left: 0, behavior: 'smooth' });
      }
    });
  }

  // Close modals on outside click or ESC
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeMatchModal();
      closeAdminModal();
    }
  });

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        closeMatchModal();
        closeAdminModal();
      }
    });
  });
}

function attemptAdminLogin() {
  const passwordInput = document.getElementById('admin-password-input');
  const errorText = document.getElementById('admin-auth-error');

  if (passwordInput && passwordInput.value === TOURNAMENT_INFO.adminAuthPassword) {
    isAdminAuthenticated = true;
    errorText.classList.add('hidden');
    passwordInput.value = '';
    closeAdminModal();
    updateAdminButtonState();
    renderAllViews();
    showToast('Mode Admin Aktif');
  } else {
    if (errorText) errorText.classList.remove('hidden');
  }
}

function updateAdminButtonState() {
  const adminBtn = document.getElementById('admin-trigger-btn');
  const adminLabel = document.getElementById('admin-label-text');
  const fabAdminLabel = document.getElementById('floating-admin-text');

  if (isAdminAuthenticated) {
    if (adminBtn) adminBtn.classList.add('logged-in');
    if (adminLabel) adminLabel.textContent = 'Keluar Admin';
    if (fabAdminLabel) fabAdminLabel.textContent = 'Keluar Admin';
  } else {
    if (adminBtn) adminBtn.classList.remove('logged-in');
    if (adminLabel) adminLabel.textContent = 'Admin';
    if (fabAdminLabel) fabAdminLabel.textContent = 'Mode Admin';
  }
}

function shareBracketUrl() {
  const encodedState = encodeURIComponent(btoa(JSON.stringify(tournamentResults)));
  const shareableUrl = `${window.location.origin}${window.location.pathname}#s=${encodedState}`;

  if (navigator.clipboard) {
    navigator.clipboard.writeText(shareableUrl)
      .then(() => showToast('Tautan bagan berhasil disalin ke clipboard'))
      .catch(() => window.prompt('Salin tautan bagan:', shareableUrl));
  } else {
    window.prompt('Salin tautan bagan:', shareableUrl);
  }
}

function showToast(message) {
  const toast = document.getElementById('toast-message');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add('show');

  clearTimeout(toast.timeoutId);
  toast.timeoutId = setTimeout(() => {
    toast.classList.remove('show');
  }, 2800);
}

function escapeQuotes(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
