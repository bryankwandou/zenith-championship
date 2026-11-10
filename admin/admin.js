// Logika Panel Wasit & Admin ZENITH 2026

import { TOURNAMENT_INFO, BRACKET_MATCHES, MATCH_BY_ID } from '../bracket-data.js';

let tournamentResults = {};
let isFirebaseConnected = false;
let activeFilterRound = 'all';
let activeSearchQuery = '';
let activeStreamController = null;

const STORAGE_KEYS = {
  RESULTS: 'zenith2026_results',
  SESSION: 'zenith_admin_session',
  THEME: 'zenith_theme'
};

// ==========================================================================
// INISIALISASI
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  applyStoredTheme();
  loadCachedResults();
  checkAdminAuthentication();
  setupAdminEventListeners();
  initializeFirebaseStream();
});

// ==========================================================================
// AUTENTIKASI ADMIN
// ==========================================================================
function checkAdminAuthentication() {
  const sessionToken = sessionStorage.getItem(STORAGE_KEYS.SESSION);
  const loginView = document.getElementById('admin-login-view');
  const dashboardView = document.getElementById('admin-dashboard-view');

  if (sessionToken === 'authenticated_nayrbryaGaming') {
    if (loginView) loginView.classList.add('hidden');
    if (dashboardView) dashboardView.classList.remove('hidden');
    renderAdminDashboard();
  } else {
    if (loginView) loginView.classList.remove('hidden');
    if (dashboardView) dashboardView.classList.add('hidden');
  }
}

window.handleAdminLoginSubmit = function(event) {
  event.preventDefault();
  const usernameInput = document.getElementById('input-admin-username');
  const passwordInput = document.getElementById('input-admin-password');
  const errorText = document.getElementById('login-error-message');

  const enteredUsername = usernameInput ? usernameInput.value.trim() : '';
  const enteredPassword = passwordInput ? passwordInput.value.trim() : '';

  if (
    enteredUsername === TOURNAMENT_INFO.adminAuthUsername &&
    enteredPassword === TOURNAMENT_INFO.adminAuthPassword
  ) {
    sessionStorage.setItem(STORAGE_KEYS.SESSION, 'authenticated_nayrbryaGaming');
    if (errorText) errorText.classList.add('hidden');
    if (usernameInput) usernameInput.value = '';
    if (passwordInput) passwordInput.value = '';
    checkAdminAuthentication();
    showToast('Autentikasi Berhasil. Selamat Datang!');
  } else {
    if (errorText) errorText.classList.remove('hidden');
  }
};

window.handleAdminLogout = function() {
  sessionStorage.removeItem(STORAGE_KEYS.SESSION);
  checkAdminAuthentication();
  showToast('Sesi admin telah ditutup');
};

// ==========================================================================
// RESOLUSI TIM DALAM SLOT PERTANDINGAN
// ==========================================================================
function resolveMatchSlot(slotDefinition, resultsMap) {
  if (typeof slotDefinition === 'string') {
    return { name: slotDefinition, isKnown: true };
  }

  if (slotDefinition && slotDefinition.w) {
    const winnerTeam = resultsMap[slotDefinition.w];
    if (winnerTeam) {
      return { name: winnerTeam, isKnown: true };
    }
    return { name: `Pemenang ${slotDefinition.w}`, isKnown: false };
  }

  if (slotDefinition && slotDefinition.l) {
    const parentMatch = MATCH_BY_ID[slotDefinition.l];
    const parentWinner = resultsMap[slotDefinition.l];
    if (!parentWinner || !parentMatch) {
      return { name: `Kalah ${slotDefinition.l}`, isKnown: false };
    }
    const teamA = resolveMatchSlot(parentMatch.s0, resultsMap);
    const teamB = resolveMatchSlot(parentMatch.s1, resultsMap);
    const loser = [teamA, teamB].find(item => item.isKnown && item.name !== parentWinner);
    if (loser) {
      return { name: loser.name, isKnown: true };
    }
    return { name: `Kalah ${slotDefinition.l}`, isKnown: false };
  }

  return { name: 'Menunggu Hasil', isKnown: false };
}

// ==========================================================================
// FIREBASE REALTIME SYNC (SSE STREAM & REST WRITES)
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

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

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
            const payload = JSON.parse(line.slice(6));
            if (payload && payload.path === '/') {
              tournamentResults = payload.data || {};
              persistCachedResults();
              renderAdminDashboard();
            } else if (payload && payload.path && payload.path.startsWith('/')) {
              const matchKey = payload.path.slice(1);
              if (payload.data === null) {
                delete tournamentResults[matchKey];
              } else {
                tournamentResults[matchKey] = payload.data;
              }
              persistCachedResults();
              renderAdminDashboard();
            }
          } catch (e) {}
          streamEvent = '';
        }
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') return;
    isFirebaseConnected = false;
    updateSyncIndicator(false, 'Mode Offline');
    setTimeout(initializeFirebaseStream, 5000);
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
  const indicator = document.getElementById('admin-sync-indicator');
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
// CACHE LOKAL
// ==========================================================================
function loadCachedResults() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.RESULTS);
    if (raw) tournamentResults = JSON.parse(raw);
  } catch (e) {
    tournamentResults = {};
  }
}

function persistCachedResults() {
  try {
    localStorage.setItem(STORAGE_KEYS.RESULTS, JSON.stringify(tournamentResults));
  } catch (e) {}
}

// ==========================================================================
// RENDERING DASHBOARD
// ==========================================================================
function renderAdminDashboard() {
  updateAdminMetrics();
  renderAdminMatchesGrid();
}

function updateAdminMetrics() {
  const completedCount = Object.keys(tournamentResults).length;
  const pendingCount = 58 - completedCount;

  const statCompleted = document.getElementById('admin-stat-completed');
  const statPending = document.getElementById('admin-stat-pending');

  if (statCompleted) statCompleted.textContent = completedCount;
  if (statPending) statPending.textContent = pendingCount;
}

function renderAdminMatchesGrid() {
  const container = document.getElementById('admin-matches-container');
  if (!container) return;

  let matchesList = BRACKET_MATCHES;

  if (activeFilterRound !== 'all') {
    matchesList = matchesList.filter(m => m.round === activeFilterRound);
  }

  if (activeSearchQuery) {
    const query = activeSearchQuery.toLowerCase();
    matchesList = matchesList.filter(m => {
      const s0 = resolveMatchSlot(m.s0, tournamentResults);
      const s1 = resolveMatchSlot(m.s1, tournamentResults);
      return (
        m.id.toLowerCase().includes(query) ||
        s0.name.toLowerCase().includes(query) ||
        s1.name.toLowerCase().includes(query)
      );
    });
  }

  if (matchesList.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; padding: 32px; text-align: center; color: var(--text-dim);">Tidak ada pertandingan yang cocok dengan filter atau pencarian.</div>`;
    return;
  }

  container.innerHTML = matchesList.map(matchItem => {
    const currentWinner = tournamentResults[matchItem.id] || null;
    const s0 = resolveMatchSlot(matchItem.s0, tournamentResults);
    const s1 = resolveMatchSlot(matchItem.s1, tournamentResults);

    const isMatchCompleted = Boolean(currentWinner);
    const nextDestination = matchItem.next ? `Pemenang ke ${matchItem.next.m}` : 'Penentuan Juara';

    return `
      <div class="admin-match-card ${isMatchCompleted ? 'completed' : ''}" id="admin-card-${matchItem.id}">
        <div class="card-top-row">
          <span style="font-family: var(--font-display); font-weight: 800; color: var(--color-primary);">${matchItem.id} · ${matchItem.round}</span>
          <span style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-dim);">${matchItem.date} · ${matchItem.time} WIB</span>
        </div>

        <div style="font-size: 0.75rem; color: var(--text-muted); display: flex; gap: 8px;">
          <span>Format: <strong>${matchItem.format}</strong></span>
          ${matchItem.kloter ? `<span>Kloter: <strong>${matchItem.kloter}</strong></span>` : ''}
          ${matchItem.stream ? `<span style="color: var(--color-stream); font-weight: 700;">STREAM</span>` : ''}
        </div>

        <div style="display: flex; flex-direction: column; gap: 6px; margin: 4px 0;">
          <button class="admin-team-action-btn ${currentWinner === s0.name ? 'is-winner' : ''}"
                  ${!s0.isKnown ? 'disabled' : ''}
                  onclick="setWinnerFromAdmin('${matchItem.id}', '${escapeQuotes(s0.name)}')">
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${s0.name}</span>
            <span>${currentWinner === s0.name ? '[MENANG]' : (s0.isKnown ? 'Tetapkan' : '')}</span>
          </button>

          <div style="text-align: center; font-size: 0.7rem; font-weight: 800; color: var(--text-dim);">VS</div>

          <button class="admin-team-action-btn ${currentWinner === s1.name ? 'is-winner' : ''}"
                  ${!s1.isKnown ? 'disabled' : ''}
                  onclick="setWinnerFromAdmin('${matchItem.id}', '${escapeQuotes(s1.name)}')">
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${s1.name}</span>
            <span>${currentWinner === s1.name ? '[MENANG]' : (s1.isKnown ? 'Tetapkan' : '')}</span>
          </button>
        </div>

        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px; padding-top: 8px; border-top: 1px solid var(--border-subtle); font-size: 0.72rem;">
          <span style="color: var(--color-win); font-weight: 600;">${nextDestination}</span>
          ${isMatchCompleted ? `
            <button class="reset-btn" onclick="setWinnerFromAdmin('${matchItem.id}', null)">Reset Hasil</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

window.setWinnerFromAdmin = async function(matchId, selectedTeamName) {
  const currentWinner = tournamentResults[matchId];
  const newWinner = currentWinner === selectedTeamName ? null : selectedTeamName;

  if (newWinner === null) {
    delete tournamentResults[matchId];
  } else {
    tournamentResults[matchId] = newWinner;
  }

  persistCachedResults();
  renderAdminDashboard();

  showToast(newWinner ? `${newWinner} menang pada ${matchId}` : `Hasil ${matchId} direset`);

  if (isFirebaseConnected) {
    const success = await writeMatchResultToFirebase(matchId, newWinner);
    if (!success) {
      showToast('Peringatan: Gagal sinkron ke Firebase RTDB');
    }
  }
};

// ==========================================================================
// TEMA & EVENT LISTENERS
// ==========================================================================
function applyStoredTheme() {
  const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);
}

function updateThemeIcon(themeName) {
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
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const target = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', target);
  localStorage.setItem(STORAGE_KEYS.THEME, target);
  updateThemeIcon(target);
}

function setupAdminEventListeners() {
  const themeBtn = document.getElementById('theme-toggle-btn');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

  const searchInput = document.getElementById('admin-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      activeSearchQuery = e.target.value.trim();
      renderAdminMatchesGrid();
    });
  }

  const roundFilter = document.getElementById('admin-round-filter');
  if (roundFilter) {
    roundFilter.addEventListener('change', e => {
      activeFilterRound = e.target.value;
      renderAdminMatchesGrid();
    });
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
  }, 2500);
}

function escapeQuotes(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
