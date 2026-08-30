/* ============================================================
   הסניף הדיגיטלי — Application Logic
   ============================================================ */

// ============================================================
// CONFIGURATION — עדכן כאן לפני פריסה
// ============================================================
const SUPABASE_URL      = 'https://nmwoepvgecnwrxzkyzeu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_9TvfEI2S3K_M95-LBzikvg_r63QVQXc';

const USER_DISPLAY = { ido: 'עידו', maor: 'מאור' };

// Each pattern (sequence of 3x3 grid node indices, 0-8 reading order) maps to a user
// — a drawn pattern is the only authentication method
const PATTERNS = {
  ido:  [2, 5, 8, 7, 6],
  maor: [4, 5, 7, 8]
};
const MIN_PATTERN_LENGTH = 4;
const PIN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Chip-to-ILS ratio: 1 chip = ₪1 (current periods and new history records)
const CHIPS_PER_SHEKEL      = 1;
const HISTORY_LEGACY_RATIO  = 10; // archive ratio for old history records

function chipsToIls(chips, ratio) {
  return n(chips) / (ratio ?? CHIPS_PER_SHEKEL);
}
function historyRatio(record) {
  return record?.chips_per_shekel ?? HISTORY_LEGACY_RATIO;
}

// ============================================================
// BOTTOM SHEET HELPERS
// ============================================================
function openSheet(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = 'flex';
  requestAnimationFrame(() => el.classList.add('open'));
}
function closeSheet(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  setTimeout(() => { if (!el.classList.contains('open')) el.style.display = 'none'; }, 350);
}

// ============================================================
// STATE
// ============================================================
let currentPeriod   = null;
let players         = [];
let profitChart     = null;
let historyData     = [];
let chartMode       = 'person'; // 'person' | 'total'
let chartMonths     = null;     // null = all, or number of months
let chartYear       = null;     // null = no year filter, or a calendar year (e.g. 2026)
let patternEntry     = [];
let patternDragging  = false;
let pinLocked        = false;
let pinInactiveTimer = null;
const acPlayerData  = {}; // { hiddenInputId: playerObject } — tracks autocomplete selections

// ============================================================
// SUPABASE REST HELPERS
// ============================================================
function sbHeaders(prefer = 'return=representation') {
  return {
    'apikey':        SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type':  'application/json',
    'Prefer':        prefer
  };
}

async function sbErrMsg(res) {
  try {
    const j = await res.json();
    return j.message || j.hint || `שגיאת שרת ${res.status}`;
  } catch {
    return `שגיאת שרת ${res.status}`;
  }
}

async function dbGet(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method: 'GET',
    headers: sbHeaders()
  });
  if (!res.ok) throw new Error(await sbErrMsg(res));
  return res.json();
}

async function dbPost(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: sbHeaders(),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await sbErrMsg(res));
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function dbPatch(table, query, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method: 'PATCH',
    headers: sbHeaders(),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await sbErrMsg(res));
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function dbDelete(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method: 'DELETE',
    headers: sbHeaders('return=minimal')
  });
  if (!res.ok) throw new Error(await sbErrMsg(res));
  return true;
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
let _notifTimer = null;

function showNotif(msg, type = 'success') {
  const el = document.getElementById('notification');
  el.textContent = msg;
  el.className   = `show ${type}`;
  if (_notifTimer) clearTimeout(_notifTimer);
  _notifTimer = setTimeout(() => { el.className = ''; }, 3800);
}

// ============================================================
// AUTH — PIN only, no login page
// ============================================================
function getCurrentUser() {
  return sessionStorage.getItem('currentUser');
}

function getDisplayName() {
  return USER_DISPLAY[getCurrentUser()] || '—';
}

function doLogout() {
  sessionStorage.removeItem('currentUser');
  currentPeriod   = null;
  players         = [];
  window._mgmtMounted = false;
  document.getElementById('app').style.display = 'none';
  showLandingScreen(); // return to home landing screen
}

// ============================================================
// APP MOUNT
// ============================================================
async function mountApp() {
  document.getElementById('app').style.display      = 'flex';
  document.getElementById('user-badge').textContent = getDisplayName();
  showManagementSection(); // switch to management tab immediately

  try {
    await loadInitialData();
  } catch (e) {
    showNotif('שגיאה בטעינת הנתונים: ' + e.message, 'error');
  }

  initPayboxSubtitles();
  showHome();
}

async function loadInitialData() {
  // current_period
  let periods = [];
  try {
    periods = await dbGet('current_period', '?id=eq.1');
  } catch {}

  if (periods && periods.length > 0) {
    currentPeriod = periods[0];
  } else {
    // First-time setup: insert the single control row
    const created = await dbPost('current_period', {
      id: 1, bit_maor: 0, bit_ido: 0, bit_ravit: 0, bit_dorin: 0,
      paybox_maor: 0, paybox_ido: 0, cashcash_ido: 0, cashcash_maor: 0, debt_ido: 0, debt_maor: 0, counter: 0, rake_app: 0, badbeat: 0
    });
    currentPeriod = (created && created[0]) ? created[0] : {
      id: 1, bit_maor: 0, bit_ido: 0, bit_ravit: 0, bit_dorin: 0,
      paybox_maor: 0, paybox_ido: 0, cashcash_ido: 0, cashcash_maor: 0, debt_ido: 0, debt_maor: 0, counter: 0, rake_app: 0, badbeat: 0
    };
  }

  // players
  try {
    players = (await dbGet('players', '?order=name.asc')) || [];
  } catch {
    players = [];
  }
}

// ============================================================
// NAVIGATION — Android App Grid
// ============================================================
// navState: 'home' | 'page' | 'blue-grid' | 'blue-tab'
let navState = 'home';
let blueTabLoaded = false;

function _setBackBtn(visible) {
  const btn = document.getElementById('back-btn');
  if (btn) btn.hidden = !visible;
}

function _hideAll() {
  document.getElementById('home-grid').hidden = true;
  document.getElementById('blue-grid').hidden = true;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
}

function showHome() {
  navState = 'home';
  document.getElementById('home-grid').hidden = false;
  document.getElementById('blue-grid').hidden = true;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  _setBackBtn(false);
  window.scrollTo({ top: 0 });
}

function openPage(page) {
  navState = 'page';
  _hideAll();
  document.getElementById('page-' + page)?.classList.add('active');
  _setBackBtn(true);
  window.scrollTo({ top: 0 });
  loadPageData(page);
}

function openBlueGrid() {
  navState = 'blue-grid';
  _hideAll();
  document.getElementById('blue-grid').hidden = false;
  _setBackBtn(true);
  window.scrollTo({ top: 0 });
  // Initialise blue table data once (forms, autocomplete, counter)
  if (!blueTabLoaded) {
    blueTabLoaded = true;
    loadPageData('blue-table');
  }
}

function openBlueTab(tab) {
  navState = 'blue-tab';
  _hideAll();
  document.getElementById('page-blue-table')?.classList.add('active');
  // Hide all tab panels then show the chosen one
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('bt-' + tab)?.classList.add('active');
  // For rakeback: show the records sub-panel by default; hide commitments
  if (tab === 'rakeback') {
    const rec = document.getElementById('rb-sub-records');
    const com = document.getElementById('rb-sub-commitments');
    if (rec) rec.style.display = '';
    if (com) com.style.display = 'none';
  }
  updateBlueSummaryVisibility();
  _setBackBtn(true);
  window.scrollTo({ top: 0 });
}

function goBack() {
  if (navState === 'blue-tab') { openBlueGrid(); return; }
  showHome();
}

// Compatibility shim — existing in-page buttons call navigate()
function navigate(page) {
  if (page === 'home') { showHome(); return; }
  openPage(page);
}

async function loadPageData(page) {
  try {
    switch (page) {
      case 'dashboard':   await loadDashboard();    break;
      case 'funds':       await loadFunds();        break;
      case 'blue-table':  await loadBlueTable();    break;
      case 'debts':       await loadDebts();        break;
      case 'history':     await loadHistory();      break;
      case 'players':     await loadPlayers();      break;
      case 'settlement':  loadSettlementPage();     break;
    }
  } catch (e) {
    showNotif('שגיאה בטעינת הדף: ' + e.message, 'error');
  }
}

// ============================================================
// PAGE 1 — DASHBOARD
// ============================================================
async function loadDashboard() {
  // Refresh current_period from DB
  try {
    const rows = await dbGet('current_period', '?id=eq.1');
    if (rows && rows.length) currentPeriod = rows[0];
  } catch {}

  const cp = currentPeriod || {};

  const liquid   = n(cp.bit_maor) + n(cp.bit_ido) + n(cp.bit_ravit) + n(cp.bit_dorin) + n(cp.paybox_maor) + n(cp.paybox_ido) + n(cp.cashcash_ido) + n(cp.cashcash_maor);
  const total    = liquid + n(cp.debt_ido) + n(cp.debt_maor) + otherPlayersDebtTotal();
  const chipsIls = chipsToIls(n(cp.counter) + n(cp.badbeat));
  const profit   = total - chipsIls;    // רווח כללי = סה"כ בקופה פחות (צ'יפים + BadBeat)
  const half     = profit / 2;
  const idoNet   = half - n(cp.debt_ido);
  const maorNet  = half - n(cp.debt_maor);

  setText('val-liquid',          fmt(liquid));
  setText('val-total',           fmt(total));
  setText('val-chips-ils',       fmt(chipsIls));
  setText('val-profit',          fmt(profit));
  setText('val-profit-ido',      fmt(half));
  setText('val-profit-maor',     fmt(half));
  setText('val-profit-ido-net',  '₪' + fmt(idoNet));
  setText('val-profit-maor-net', '₪' + fmt(maorNet));

  // Rake control card
  const rakeApp     = n(cp.rake_app);
  const controlCard = document.getElementById('rake-control-card');
  if (rakeApp > 0 && controlCard) {
    controlCard.style.display = '';
    const gap = profit - rakeApp;
    const pct = Math.abs(gap) / rakeApp * 100;
    const gapColor = pct > 10 ? 'var(--negative)' : 'var(--positive)';
    setText('ctrl-rake',   '₪' + fmt(rakeApp));
    setText('ctrl-profit', '₪' + fmt(profit));
    const gapEl = document.getElementById('ctrl-gap');
    if (gapEl) {
      gapEl.textContent = (gap >= 0 ? '+' : '') + '₪' + fmt(gap) + ' (' + pct.toFixed(1) + '%)';
      gapEl.style.color = gapColor;
    }
  } else if (controlCard) {
    controlCard.style.display = 'none';
  }

  // Dynamic profit card colour
  const profitEl = document.getElementById('sv-profit');
  if (profitEl) {
    profitEl.className = 'stat-value ' + (profit >= 0 ? 'positive' : 'negative');
  }
  const profitCard = document.getElementById('card-profit');
  if (profitCard) {
    profitCard.className = 'stat-card ' + (profit >= 0 ? 'positive' : 'negative');
  }

  // Blue table summary for dashboard card
  refreshBTSummary();
}

// ============================================================
// PAGE 2 — FUNDS
// ============================================================
async function loadFunds() {
  const cp = currentPeriod || {};

  setVal('bit_maor',      cp.bit_maor    || '');
  setVal('bit_ido',       cp.bit_ido     || '');
  setVal('bit_ravit',     cp.bit_ravit   || '');
  setVal('bit_dorin',     cp.bit_dorin   || '');
  setVal('paybox_maor',   cp.paybox_maor || '');
  setVal('paybox_ido',    cp.paybox_ido  || '');
  setVal('cashcash_ido',  cp.cashcash_ido  || '');
  setVal('cashcash_maor', cp.cashcash_maor || '');
  setVal('funds-debt_ido',  cp.debt_ido  || '');
  setVal('funds-debt_maor', cp.debt_maor || '');
  setVal('rake_app',        cp.rake_app  || '');

  initPayboxSubtitles();
  updateFundsSummary();
}

function updateFundsSummary() {
  const g = id => parseFloat(document.getElementById(id)?.value) || 0;
  const liquid = g('bit_maor') + g('bit_ido') + g('bit_ravit') + g('bit_dorin') + g('paybox_maor') + g('paybox_ido') + g('cashcash_ido') + g('cashcash_maor');
  const total  = liquid + g('funds-debt_ido') + g('funds-debt_maor') + otherPlayersDebtTotal();

  setText('funds-liquid', '₪' + fmt(liquid));
  setText('funds-total',  '₪' + fmt(total));
}

async function saveFunds() {
  try {
    const g = id => parseFloat(document.getElementById(id)?.value) || 0;
    const data = {
      bit_maor: g('bit_maor'),    bit_ido: g('bit_ido'),
      bit_ravit: g('bit_ravit'),  bit_dorin: g('bit_dorin'),
      paybox_maor: g('paybox_maor'), paybox_ido: g('paybox_ido'),
      cashcash_ido: g('cashcash_ido'), cashcash_maor: g('cashcash_maor'),
      rake_app: g('rake_app'),
      updated_at: now()
    };

    await dbPatch('current_period', '?id=eq.1', data);
    Object.assign(currentPeriod, data);
    showNotif('✅ כספים נשמרו');
  } catch (e) {
    showNotif('שגיאה בשמירה: ' + e.message, 'error');
  }
}

let fundsSaveTimer = null;
function onFundsInput() {
  updateFundsSummary();
  clearTimeout(fundsSaveTimer);
  fundsSaveTimer = setTimeout(saveFunds, 700);
}
function onFundsBlur() {
  clearTimeout(fundsSaveTimer);
  saveFunds();
}

// ============================================================
// PAGE 3 — BLUE TABLE
// ============================================================
function switchBlueTab(tab) {
  openBlueTab(tab);
}

// Hide the blue-table expense/withdrawal summary bar on the commitments sub-tab
function updateBlueSummaryVisibility() {
  const bar = document.getElementById('bt-summary-bar');
  if (!bar) return;
  const onCommitments =
    document.getElementById('bt-rakeback')?.classList.contains('active') &&
    document.getElementById('rb-sub-commitments')?.style.display !== 'none';
  bar.style.display = onCommitments ? 'none' : '';
}

async function loadBlueTable() {
  // Refresh players list in case it changed
  try { players = (await dbGet('players', '?order=name.asc')) || []; } catch {}

  initAllPlayerACs();

  // Set today's date on withdrawal form if empty
  const wdDate = document.getElementById('wd-date');
  if (wdDate && !wdDate.value) wdDate.value = today();

  // Load counter + badbeat
  if (currentPeriod) {
    setVal('counter-value', currentPeriod.counter || '');
    setVal('badbeat-value', currentPeriod.badbeat || '');
    updateCounterDisplay();
    updateBadBeatDisplay();
  }

  await Promise.all([
    loadRakebackTable(),
    loadTournamentsTable(),
    loadBonusesTable(),
    loadReferralsTable(),
    loadWithdrawalsTable(),
    loadExpensesTable()
  ]);

  await refreshBTSummary();
}

// ============================================================
// PLAYER AUTOCOMPLETE WIDGET
// ============================================================
function initPlayerAC(wrapId, hiddenId, filterFn, onSelect) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  if (wrap.dataset.acInit) return; // already wired up — listeners stay, list refreshes via global players
  wrap.dataset.acInit = '1';

  const textInput  = wrap.querySelector('.player-ac-input');
  const hiddenInput = document.getElementById(hiddenId);
  const listEl     = wrap.querySelector('.player-ac-list');

  function getList() {
    return filterFn ? players.filter(filterFn) : [...players];
  }

  function renderList(list) {
    if (!list.length) { listEl.style.display = 'none'; return; }
    listEl.innerHTML = list.map(p => {
      const nick = escHtml(p.nickname || p.name);
      const sub  = p.nickname ? `<span class="player-ac-sub">${escHtml(p.name)}</span>` : '';
      return `<li class="player-ac-item" data-id="${p.id}">${nick}${sub}</li>`;
    }).join('');
    listEl.style.display = 'block';
    listEl.querySelectorAll('.player-ac-item').forEach(li => {
      li.addEventListener('mousedown', e => {
        e.preventDefault();
        const p = getList().find(x => x.id === li.dataset.id);
        if (!p) return;
        hiddenInput.value      = p.id;
        textInput.value        = p.nickname || p.name;
        acPlayerData[hiddenId] = p;
        listEl.style.display   = 'none';
        if (onSelect) onSelect(p);
      });
    });
  }

  textInput.addEventListener('input', () => {
    const q = textInput.value.trim().toLowerCase();
    hiddenInput.value = '';
    delete acPlayerData[hiddenId];
    if (!q) { listEl.style.display = 'none'; return; }
    renderList(getList().filter(p =>
      (p.nickname || '').toLowerCase().includes(q) ||
      (p.name || '').toLowerCase().includes(q)
    ));
  });

  textInput.addEventListener('focus', () => {
    const q = textInput.value.trim().toLowerCase();
    const all = getList();
    renderList(q ? all.filter(p =>
      (p.nickname || '').toLowerCase().includes(q) ||
      (p.name || '').toLowerCase().includes(q)
    ) : all);
  });

  textInput.addEventListener('blur', () => {
    setTimeout(() => { listEl.style.display = 'none'; }, 150);
  });
}

function clearPlayerAC(hiddenId) {
  const wrap = document.getElementById(hiddenId + '-wrap');
  if (wrap) {
    const inp  = wrap.querySelector('.player-ac-input');
    const list = wrap.querySelector('.player-ac-list');
    if (inp)  inp.value = '';
    if (list) list.style.display = 'none';
  }
  const hid = document.getElementById(hiddenId);
  if (hid) hid.value = '';
  delete acPlayerData[hiddenId];
}

function rakebackActive(p) {
  if (!((p.rakeback_percent || 0) > 0)) return false;
  if (!p.rakeback_until) return true;          // no expiry date = always active
  return p.rakeback_until >= today();          // inclusive of the expiry day itself
}

function rakebackCellLabel(p) {
  if (p.rakeback_percent == null || p.rakeback_percent === '') return '—';
  let s = p.rakeback_percent + '%';
  if (p.rakeback_until) {
    const expired = p.rakeback_until < today();
    s += expired
      ? ` <span style="color:var(--negative)">· פג ${fmtDate(p.rakeback_until)}</span>`
      : ` <span style="color:var(--text-muted)">· עד ${fmtDate(p.rakeback_until)}</span>`;
  }
  return s;
}

function initAllPlayerACs() {
  // rb-player: only players with active rakeback (percent > 0 and not expired)
  initPlayerAC('rb-player-wrap', 'rb-player',
    p => rakebackActive(p),
    () => updateRakebackCalc()
  );
  initPlayerAC('tn-player-wrap', 'tn-player', null);
  initPlayerAC('bn-player-wrap', 'bn-player', null);
  initPlayerAC('ref-from-wrap',  'ref-from',  null);
  initPlayerAC('ref-to-wrap',    'ref-to',    null);
  initPlayerAC('wd-player-wrap', 'wd-player', null);
  initPlayerAC('pd-player-wrap', 'pd-player', null);
}

// — Counter —
function updateCounterDisplay() {
  updateBadBeatDisplay(); // keep total-ils in sync
}

async function saveCounter() {
  try {
    const val = parseFloat(document.getElementById('counter-value').value) || 0;
    await dbPatch('current_period', '?id=eq.1', { counter: val, updated_at: now() });
    currentPeriod.counter = val;
    showNotif('✅ Counter נשמר בהצלחה');
    loadDashboard();
  } catch (e) {
    showNotif('שגיאה: ' + e.message, 'error');
  }
}

let counterSaveTimer = null;
function onCounterInput() {
  updateCounterDisplay();
  clearTimeout(counterSaveTimer);
  counterSaveTimer = setTimeout(saveCounter, 700);
}
function onCounterBlur() {
  clearTimeout(counterSaveTimer);
  saveCounter();
}

// — BadBeat —
function updateBadBeatDisplay() {
  const bb  = parseFloat(document.getElementById('badbeat-value')?.value) || 0;
  const ctr = parseFloat(document.getElementById('counter-value')?.value) || 0;
  setText('counter-total-ils', '₪' + fmt(chipsToIls(ctr + bb)));
}

async function saveBadBeat() {
  try {
    const val = parseFloat(document.getElementById('badbeat-value').value) || 0;
    await dbPatch('current_period', '?id=eq.1', { badbeat: val, updated_at: now() });
    currentPeriod.badbeat = val;
    loadDashboard();
  } catch (e) {
    showNotif('שגיאה בשמירת BadBeat: ' + e.message, 'error');
  }
}

let badBeatSaveTimer = null;
function onBadBeatInput() {
  updateBadBeatDisplay();
  clearTimeout(badBeatSaveTimer);
  badBeatSaveTimer = setTimeout(saveBadBeat, 700);
}
function onBadBeatBlur() {
  clearTimeout(badBeatSaveTimer);
  saveBadBeat();
}

// — Rakeback —
function updateRakebackCalc() {
  const p    = acPlayerData['rb-player'];
  const rake = parseFloat(document.getElementById('rb-rake')?.value) || 0;
  const pct  = parseFloat(p?.rakeback_percent) || 60;
  setText('rb-calc', fmt(rake * pct / 100) + ' צ\'יפים');
}

async function loadRakebackTable() {
  try {
    const data = await dbGet('blue_table_rakeback', '?order=created_at.desc&select=*,players(name,nickname)');
    const tbody = document.getElementById('rb-table-body');
    if (!data || !data.length) {
      tbody.innerHTML = '<div class="md-list-empty">אין רשומות בתקופה הנוכחית</div>';
      setText('bt-rb-summary', '');
      return;
    }
    tbody.innerHTML = data.map(r => `
      <div class="md-list-item">
        <div class="md-list-content">
          <div class="md-list-title">${playerLabel(r.players?.name, r.players?.nickname)}</div>
          <div class="md-list-subtitle">${fmtDate(r.created_at)} · גנייה: ${fmt(r.rake_taken)} צ' · ${fmt(r.rakeback_percent)}%</div>
        </div>
        <div class="md-list-trailing chips-color">${fmt(r.rakeback_amount)} צ'</div>
        <button class="md-icon-btn" onclick="deleteRecord('blue_table_rakeback','${r.id}','loadRakebackTable')" title="מחק">🗑️</button>
      </div>`).join('');
    const total = data.reduce((s, r) => s + n(r.rakeback_amount), 0);
    setText('bt-rb-summary', `סה"כ: ${fmt(total)} צ' | ₪${fmt(chipsToIls(total))}`);
  } catch (e) {
    showNotif('שגיאה בטעינת החזרי גנייה: ' + e.message, 'error');
  }
}

async function addRakeback() {
  const playerId = document.getElementById('rb-player').value;
  const rake     = parseFloat(document.getElementById('rb-rake').value);
  if (!playerId) { showNotif('אנא בחר שחקן', 'error'); return; }
  if (!rake || rake <= 0) { showNotif('אנא הזן כמות גנייה תקינה', 'error'); return; }

  const p      = acPlayerData['rb-player'];
  const pct    = parseFloat(p?.rakeback_percent) || 60;
  const amount = rake * pct / 100;

  try {
    await dbPost('blue_table_rakeback', {
      player_id: playerId, rake_taken: rake,
      rakeback_percent: pct, rakeback_amount: amount,
      created_by: getDisplayName(), created_at: now()
    });
    document.getElementById('rb-rake').value = '';
    setText('rb-calc', '0 צ\'יפים');
    clearPlayerAC('rb-player');
    showNotif('✅ רשומת החזר גנייה נוספה');
    closeSheet('rb-sheet');
    await loadRakebackTable();
    refreshBTSummary();
  } catch (e) {
    showNotif('שגיאה: ' + e.message, 'error');
  }
}

// ============================================================
// RAKEBACK COMMITMENTS TABLE (payment-tracking sub-tab)
// Stored as a single jsonb row in `rakeback_commitments` (id=1)
// ============================================================
let rctState     = null;
let rctSaveTimer = null;
let rctInited    = false;
const RCT_MIN_COLS = 11;

function switchRakebackSubTab(name) {
  const rec = document.getElementById('rb-sub-records');
  const com = document.getElementById('rb-sub-commitments');
  if (rec) rec.style.display = name === 'records'      ? '' : 'none';
  if (com) com.style.display = name === 'commitments'  ? '' : 'none';
  if (name === 'commitments') initRakebackCommitments();
  updateBlueSummaryVisibility();
}

async function initRakebackCommitments() {
  if (rctInited) return;
  rctInited = true;
  document.getElementById('rct-addRowBtn').addEventListener('click', rctAddRow);
  document.getElementById('rct-addColBtn').addEventListener('click', rctAddPaymentColumn);
  document.getElementById('rct-delColBtn').addEventListener('click', rctRemovePaymentColumn);
  document.getElementById('rct-exportExcelBtn').addEventListener('click', rctExportExcel);
  await rctLoadState();
  rctRenderAll();
}

async function rctLoadState() {
  try {
    const rows = await dbGet('rakeback_commitments', '?id=eq.1');
    const data = rows && rows[0] && rows[0].data ? rows[0].data : null;
    if (data && Array.isArray(data.people)) {
      rctState = { people: data.people, paymentCols: data.paymentCols > 0 ? data.paymentCols : RCT_MIN_COLS };
    } else {
      rctState = { people: [], paymentCols: RCT_MIN_COLS };
    }
  } catch (e) {
    rctState = { people: [], paymentCols: RCT_MIN_COLS };
    showNotif('שגיאה בטעינת טבלת ההתחייבויות: ' + e.message, 'error');
  }
}

function rctScheduleSave() {
  const pillText = document.getElementById('rct-savePillText');
  if (pillText) pillText.textContent = 'שומר…';
  const pill = document.getElementById('rct-savePill');
  if (pill) pill.style.opacity = '0.7';
  clearTimeout(rctSaveTimer);
  rctSaveTimer = setTimeout(rctPersist, 400);
}

async function rctPersist() {
  try {
    await dbPatch('rakeback_commitments', '?id=eq.1', { data: rctState, updated_at: now() });
    rctFlashSaved(true);
  } catch (e) {
    rctFlashSaved(false);
  }
}

function rctFlashSaved(ok) {
  const pill = document.getElementById('rct-savePill');
  const text = document.getElementById('rct-savePillText');
  if (pill) pill.style.opacity = '1';
  if (text) text.textContent = ok ? 'נשמר' : 'שמירה נכשלה';
}

function rctLastFilledPayment(payments) {
  for (let i = payments.length - 1; i >= 0; i--) {
    const v = payments[i];
    if (v !== '' && v !== null && v !== undefined && String(v).trim() !== '') return { value: v, index: i };
  }
  return null;
}

function rctFmtDateShort(iso) {
  const parts = String(iso || '').split('-'); // YYYY-MM-DD
  return parts.length === 3 ? parts[2] + '/' + parts[1] : String(iso || '');
}

function rctCountFilled(payments) {
  return payments.filter(v => v !== '' && v !== null && v !== undefined && String(v).trim() !== '').length;
}

function rctMakeCellInput(cls, value, placeholder, type) {
  const input = document.createElement('input');
  input.className = 'rct-cell ' + cls;
  input.type = type || 'text';
  if (type === 'number') input.step = '0.1';
  input.value = value === undefined || value === null ? '' : value;
  if (placeholder) input.placeholder = placeholder;
  return input;
}

function rctRenderHeader() {
  const headRow = document.getElementById('rct-headRow');
  headRow.querySelectorAll('th[data-paycol]').forEach(th => th.remove());
  const progressTh = document.getElementById('rct-progress-th');
  for (let i = 0; i < rctState.paymentCols; i++) {
    const th = document.createElement('th');
    th.setAttribute('data-paycol', i);
    th.textContent = (i + 1);
    headRow.insertBefore(th, progressTh);
  }
}

function rctPopulatePlayersList() {
  const dl = document.getElementById('rct-players-list');
  if (!dl) return;
  dl.innerHTML = (players || [])
    .map(p => `<option value="${escHtml(p.nickname || p.name)}"></option>`)
    .join('');
}

function rctUpdateRowData(rowIdx, field, value, payIdx) {
  const person = rctState.people[rowIdx];
  if (field === 'note') person.note = value;
  else if (field === 'name') person.name = value;
  else if (field === 'percent') person.percent = value === '' ? '' : parseFloat(value) / 100;
  else if (field === 'payment') {
    while (person.payments.length <= payIdx) person.payments.push('');
    person.payments[payIdx] = value; // date string (YYYY-MM-DD) or ''
    // when a date is cleared, also clear paid status
    if (!value) {
      if (!person.paid) person.paid = [];
      person.paid[payIdx] = false;
    }
  } else if (field === 'paid') {
    if (!person.paid) person.paid = [];
    person.paid[payIdx] = value;
  }
  rctScheduleSave();
  rctRenderProgress(rowIdx);
  rctUpdateFooter();
}

function rctRenderProgress(rowIdx) {
  const person = rctState.people[rowIdx];
  const filled = rctCountFilled(person.payments);
  const pct = Math.round((filled / rctState.paymentCols) * 100);
  const track = document.querySelector('[data-rct-track="' + rowIdx + '"]');
  const label = document.querySelector('[data-rct-label="' + rowIdx + '"]');
  if (track) track.style.width = pct + '%';
  if (label) {
    const last = rctLastFilledPayment(person.payments);
    label.textContent = filled + '/' + rctState.paymentCols + (last ? ' · אחרון: ' + rctFmtDateShort(last.value) : '');
  }
}

function rctUpdateFooter() {
  const el = document.getElementById('rct-rowCount');
  if (el) el.textContent = rctState.people.length + ' שמות בטבלה';
}

function rctRenderBody() {
  const tbody = document.getElementById('rct-tbody');
  tbody.innerHTML = '';

  if (rctState.people.length === 0) {
    const tr = document.createElement('tr');
    tr.className = 'rct-empty-row';
    const td = document.createElement('td');
    td.colSpan = 4 + rctState.paymentCols;
    td.textContent = 'אין שמות בטבלה עדיין — לחצו על "＋ שם" כדי להתחיל';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  rctState.people.forEach((person, rowIdx) => {
    const tr = document.createElement('tr');

    // Percent input (created first so the name picker can auto-fill it)
    const percentInput = rctMakeCellInput('rct-percent', person.percent === '' || person.percent === undefined ? '' : Math.round(person.percent * 1000) / 10, '%', 'number');
    percentInput.step = '1'; percentInput.min = '0'; percentInput.max = '100';
    percentInput.addEventListener('input', e => rctUpdateRowData(rowIdx, 'percent', e.target.value));

    // Name (frozen right) — choose from players; auto-fills the rakeback % from the chosen player
    const tdName = document.createElement('td');
    tdName.className = 'rct-col-name';
    const nameInput = rctMakeCellInput('rct-name-input', person.name, 'שם…');
    nameInput.setAttribute('list', 'rct-players-list');
    nameInput.addEventListener('input', e => {
      rctUpdateRowData(rowIdx, 'name', e.target.value);
      const match = (players || []).find(p => (p.nickname || p.name) === e.target.value);
      if (match && match.rakeback_percent != null && match.rakeback_percent !== '') {
        rctState.people[rowIdx].percent = parseFloat(match.rakeback_percent) / 100;
        percentInput.value = Math.round(rctState.people[rowIdx].percent * 1000) / 10;
        rctScheduleSave();
      }
    });
    tdName.appendChild(nameInput);
    tr.appendChild(tdName);

    // Percent cell
    const tdPercent = document.createElement('td');
    tdPercent.className = 'rct-col-pct';
    tdPercent.appendChild(percentInput);
    tr.appendChild(tdPercent);

    // Payment beats
    for (let i = 0; i < rctState.paymentCols; i++) {
      const td = document.createElement('td');
      const val  = person.payments[i];
      const isPaid = !!(person.paid && person.paid[i]);
      const beatIdx = i;

      // Compact cell: shows date in red (pending) or green+✓ (paid) on click
      const wrap = document.createElement('div');
      const stateClass = val ? (isPaid ? ' rct-beat-paid' : ' rct-beat-pending') : '';
      wrap.className = 'rct-beat' + (val ? ' filled' : '') + stateClass;

      // ✓ badge (top-left corner, visible only when paid)
      const badge = document.createElement('span');
      badge.className = 'rct-beat-check';
      badge.textContent = '✓';

      const label = document.createElement('span');
      label.className = 'rct-beat-label';
      label.textContent = val ? rctFmtDateShort(val) : '＋';

      const dInput = document.createElement('input');
      dInput.type = 'date';
      dInput.className = 'rct-beat-input';
      if (val) dInput.value = val;

      // Click on a filled beat: toggle paid/pending; on an empty beat: open date picker
      wrap.addEventListener('click', e => {
        if (dInput.contains(e.target)) return;
        if (val || dInput.value) {
          // toggle paid status
          const nowPaid = !rctState.people[rowIdx].paid?.[beatIdx];
          rctUpdateRowData(rowIdx, 'paid', nowPaid, beatIdx);
          wrap.classList.toggle('rct-beat-pending', !nowPaid);
          wrap.classList.toggle('rct-beat-paid',    nowPaid);
        } else {
          try { dInput.showPicker(); } catch (err) { dInput.focus(); }
        }
      });

      dInput.addEventListener('input', e => {
        const newVal = e.target.value;
        rctUpdateRowData(rowIdx, 'payment', newVal, beatIdx);
        label.textContent = newVal ? rctFmtDateShort(newVal) : '＋';
        wrap.classList.toggle('filled', !!newVal);
        // new date defaults to pending (red)
        wrap.classList.toggle('rct-beat-pending', !!newVal);
        wrap.classList.toggle('rct-beat-paid', false);
      });

      wrap.appendChild(badge);
      wrap.appendChild(label);
      wrap.appendChild(dInput);
      td.appendChild(wrap);
      tr.appendChild(td);
    }

    // Progress (hidden — column removed from view)
    const tdProgress = document.createElement('td');
    tdProgress.style.display = 'none';
    tdProgress.innerHTML =
      '<div class="rct-progress-fill" data-rct-track="' + rowIdx + '" style="width:0%"></div>' +
      '<div data-rct-label="' + rowIdx + '"></div>';
    tr.appendChild(tdProgress);

    // Note (least-scanned — placed near the end)
    const tdNote = document.createElement('td');
    tdNote.className = 'rct-col-note';
    const noteInput = rctMakeCellInput('rct-note-input', person.note, 'הערה…');
    noteInput.addEventListener('input', e => rctUpdateRowData(rowIdx, 'note', e.target.value));
    tdNote.appendChild(noteInput);
    tr.appendChild(tdNote);

    // Delete
    const tdDel = document.createElement('td');
    tdDel.className = 'rct-col-del';
    const delBtn = document.createElement('button');
    delBtn.className = 'rct-del-btn';
    delBtn.title = 'מחיקת שורה';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => {
      if (confirm('למחוק את "' + (person.name || 'השורה') + '" מהטבלה?')) {
        rctState.people.splice(rowIdx, 1);
        rctScheduleSave();
        rctRenderAll();
      }
    });
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);

    tbody.appendChild(tr);
  });

  rctState.people.forEach((_, i) => rctRenderProgress(i));
}

function rctRenderAll() {
  rctPopulatePlayersList();
  rctRenderHeader();
  rctRenderBody();
  rctUpdateFooter();
}

function rctAddRow() {
  rctState.people.push({ note: '', name: '', percent: '', payments: [], paid: [] });
  rctScheduleSave();
  rctRenderAll();
  const inputs = document.querySelectorAll('#rct-tbody tr:last-child input');
  if (inputs.length > 1) inputs[1].focus();
}

function rctAddPaymentColumn() {
  rctState.paymentCols += 1;
  rctScheduleSave();
  rctRenderAll();
}

function rctRemovePaymentColumn() {
  if (rctState.paymentCols <= 1) return;
  const lastIdx = rctState.paymentCols - 1;
  const hasData = rctState.people.some(p => {
    const v = p.payments[lastIdx];
    return v !== '' && v !== null && v !== undefined && String(v).trim() !== '';
  });
  if (hasData && !confirm('בפעימה האחרונה יש נתונים שיימחקו. להסיר בכל זאת?')) return;
  rctState.paymentCols -= 1;
  // Drop any orphaned values beyond the new column count
  rctState.people.forEach(p => {
    if (p.payments.length > rctState.paymentCols) p.payments.length = rctState.paymentCols;
  });
  rctScheduleSave();
  rctRenderAll();
}

function rctExportExcel() {
  if (typeof XLSX === 'undefined') {
    showNotif('ספריית האקסל לא נטענה — נסה לרענן את הדף', 'error');
    return;
  }
  const headers = ['שם', 'אחוז החזר'];
  for (let i = 0; i < rctState.paymentCols; i++) headers.push('פעימה ' + (i + 1));
  headers.push('הערות');
  const aoa = [headers];
  rctState.people.forEach(p => {
    const row = [
      p.name || '',
      p.percent === '' || p.percent === undefined ? '' : Math.round(p.percent * 1000) / 10
    ];
    for (let i = 0; i < rctState.paymentCols; i++) {
      row.push(p.payments[i] !== undefined && p.payments[i] !== '' ? p.payments[i] : '');
    }
    row.push(p.note || '');
    aoa.push(row);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'החזרי גניות');
  XLSX.writeFile(wb, 'החזרי_גניות_' + today() + '.xlsx');
}

// — Tournaments —
async function loadTournamentsTable() {
  try {
    const data = await dbGet('blue_table_tournaments', '?order=created_at.desc&select=*,players(name,nickname)');
    const tbody = document.getElementById('tn-table-body');
    if (!data || !data.length) {
      tbody.innerHTML = '<div class="md-list-empty">אין רשומות בתקופה הנוכחית</div>';
      setText('bt-tn-summary', '');
      return;
    }
    tbody.innerHTML = data.map(r => `
      <div class="md-list-item">
        <div class="md-list-content">
          <div class="md-list-title">${playerLabel(r.players?.name, r.players?.nickname)}</div>
          <div class="md-list-subtitle">${fmtDate(r.created_at)} · ${r.tournament_type === 'omaha' ? 'אומהה' : 'הולדם'}</div>
        </div>
        <div class="md-list-trailing chips-color">${fmt(r.prize_chips)} צ'</div>
        <button class="md-icon-btn" onclick="deleteRecord('blue_table_tournaments','${r.id}','loadTournamentsTable')" title="מחק">🗑️</button>
      </div>`).join('');
    const total = data.reduce((s, r) => s + n(r.prize_chips), 0);
    setText('bt-tn-summary', `סה"כ: ${fmt(total)} צ' | ₪${fmt(chipsToIls(total))}`);
  } catch (e) {
    showNotif('שגיאה בטעינת טורנירים: ' + e.message, 'error');
  }
}

async function addTournament() {
  const playerId = document.getElementById('tn-player').value;
  const type     = document.getElementById('tn-type').value;
  const prize    = parseFloat(document.getElementById('tn-prize').value);
  if (!playerId) { showNotif('אנא בחר שחקן', 'error'); return; }
  if (!prize || prize <= 0) { showNotif('אנא הזן סכום פרס תקין', 'error'); return; }

  try {
    await dbPost('blue_table_tournaments', {
      player_id: playerId, tournament_type: type,
      prize_chips: prize, created_by: getDisplayName(), created_at: now()
    });
    document.getElementById('tn-prize').value = '';
    clearPlayerAC('tn-player');
    showNotif('✅ רשומת טורניר נוספה');
    closeSheet('tn-sheet');
    await loadTournamentsTable();
    refreshBTSummary();
  } catch (e) {
    showNotif('שגיאה: ' + e.message, 'error');
  }
}

// — Bonuses —
async function loadBonusesTable() {
  try {
    const data = await dbGet('blue_table_bonuses', '?order=created_at.desc&select=*,players(name,nickname)');
    const tbody = document.getElementById('bn-table-body');
    if (!data || !data.length) {
      tbody.innerHTML = '<div class="md-list-empty">אין רשומות בתקופה הנוכחית</div>';
      setText('bt-bn-summary', '');
      return;
    }
    tbody.innerHTML = data.map(r => `
      <div class="md-list-item">
        <div class="md-list-content">
          <div class="md-list-title">${playerLabel(r.players?.name, r.players?.nickname)}</div>
          <div class="md-list-subtitle">${fmtDate(r.created_at)}${r.note ? ' · ' + escHtml(r.note) : ''}</div>
        </div>
        <div class="md-list-trailing chips-color">${fmt(r.chips_amount)} צ'</div>
        <button class="md-icon-btn" onclick="deleteRecord('blue_table_bonuses','${r.id}','loadBonusesTable')" title="מחק">🗑️</button>
      </div>`).join('');
    const total = data.reduce((s, r) => s + n(r.chips_amount), 0);
    setText('bt-bn-summary', `סה"כ: ${fmt(total)} צ' | ₪${fmt(chipsToIls(total))}`);
  } catch (e) {
    showNotif('שגיאה בטעינת בונוסים: ' + e.message, 'error');
  }
}

async function addBonus() {
  const playerId = document.getElementById('bn-player').value;
  const chips    = parseFloat(document.getElementById('bn-chips').value);
  const note     = document.getElementById('bn-note').value.trim();
  if (!playerId) { showNotif('אנא בחר שחקן', 'error'); return; }
  if (!chips || chips <= 0) { showNotif('אנא הזן כמות תקינה', 'error'); return; }

  try {
    await dbPost('blue_table_bonuses', {
      player_id: playerId, chips_amount: chips, note: note || null,
      created_by: getDisplayName(), created_at: now()
    });
    document.getElementById('bn-chips').value = '';
    document.getElementById('bn-note').value = '';
    clearPlayerAC('bn-player');
    showNotif('✅ בונוס נוסף');
    closeSheet('bn-sheet');
    await loadBonusesTable();
    refreshBTSummary();
  } catch (e) {
    showNotif('שגיאה: ' + e.message, 'error');
  }
}

// — Referrals —
async function loadReferralsTable() {
  try {
    const data = await dbGet('blue_table_referrals',
      '?order=created_at.desc&select=id,chips_amount,created_by,created_at,referring_player_id,referred_player_id');
    const tbody = document.getElementById('ref-table-body');
    if (!data || !data.length) {
      tbody.innerHTML = '<div class="md-list-empty">אין רשומות בתקופה הנוכחית</div>';
      setText('bt-ref-summary', '');
      return;
    }
    tbody.innerHTML = data.map(r => {
      const from = players.find(p => p.id === r.referring_player_id);
      const to   = players.find(p => p.id === r.referred_player_id);
      return `
        <div class="md-list-item">
          <div class="md-list-content">
            <div class="md-list-title">${playerLabel(from?.name, from?.nickname)} ← ${playerLabel(to?.name, to?.nickname)}</div>
            <div class="md-list-subtitle">${fmtDate(r.created_at)}</div>
          </div>
          <div class="md-list-trailing chips-color">${fmt(r.chips_amount)} צ'</div>
          <button class="md-icon-btn" onclick="deleteRecord('blue_table_referrals','${r.id}','loadReferralsTable')" title="מחק">🗑️</button>
        </div>`;
    }).join('');
    const total = data.reduce((s, r) => s + n(r.chips_amount), 0);
    setText('bt-ref-summary', `סה"כ: ${fmt(total)} צ' | ₪${fmt(chipsToIls(total))}`);
  } catch (e) {
    showNotif('שגיאה בטעינת חבר מביא חבר: ' + e.message, 'error');
  }
}

async function addReferral() {
  const fromId = document.getElementById('ref-from').value;
  const toId   = document.getElementById('ref-to').value;
  const chips  = parseFloat(document.getElementById('ref-chips').value);
  if (!fromId)         { showNotif('אנא בחר שחקן מביא', 'error');   return; }
  if (!toId)           { showNotif('אנא בחר שחקן מובא', 'error');   return; }
  if (fromId === toId) { showNotif('לא ניתן לבחור אותו שחקן פעמיים', 'error'); return; }
  if (!chips || chips <= 0) { showNotif('אנא הזן סכום תקין', 'error'); return; }

  try {
    await dbPost('blue_table_referrals', {
      referring_player_id: fromId, referred_player_id: toId,
      chips_amount: chips, created_by: getDisplayName(), created_at: now()
    });
    document.getElementById('ref-chips').value = '';
    clearPlayerAC('ref-from');
    clearPlayerAC('ref-to');
    showNotif('✅ רשומת חבר מביא חבר נוספה');
    closeSheet('ref-sheet');
    await loadReferralsTable();
    refreshBTSummary();
  } catch (e) {
    showNotif('שגיאה: ' + e.message, 'error');
  }
}

// — Withdrawals —
async function loadWithdrawalsTable() {
  try {
    const data = await dbGet('withdrawals', '?order=created_at.desc&select=*,players(name,nickname)');
    const tbody = document.getElementById('wd-table-body');
    if (!data || !data.length) {
      tbody.innerHTML = '<div class="md-list-empty">אין רשומות בתקופה הנוכחית</div>';
      setText('bt-wd-summary', '');
      return;
    }
    tbody.innerHTML = data.map(r => `
      <div class="md-list-item">
        <div class="md-list-content">
          <div class="md-list-title">${playerLabel(r.players?.name, r.players?.nickname)}</div>
          <div class="md-list-subtitle">${r.withdrawal_date || fmtDate(r.created_at)} · ${fmt(r.chips_amount)} צ'</div>
        </div>
        <div class="md-list-trailing positive-color">₪${fmt(chipsToIls(r.chips_amount))}</div>
        <button class="md-icon-btn" onclick="deleteRecord('withdrawals','${r.id}','loadWithdrawalsTable')" title="מחק">🗑️</button>
      </div>`).join('');
    const totalChips = data.reduce((s, r) => s + n(r.chips_amount), 0);
    setText('bt-wd-summary', `סה"כ: ₪${fmt(chipsToIls(totalChips))} | ${fmt(totalChips)} צ'`);
  } catch (e) {
    showNotif('שגיאה בטעינת משיכות: ' + e.message, 'error');
  }
}

async function addWithdrawal() {
  const playerId = document.getElementById('wd-player').value;
  const date     = document.getElementById('wd-date').value;
  const chips    = parseFloat(document.getElementById('wd-chips').value);
  if (!playerId)           { showNotif('אנא בחר שחקן', 'error');               return; }
  if (!date)               { showNotif('אנא בחר תאריך', 'error');              return; }
  if (!chips || chips <= 0){ showNotif('אנא הזן כמות צ\'יפים תקינה', 'error'); return; }

  const ils = chipsToIls(chips);

  try {
    await dbPost('withdrawals', {
      player_id: playerId, withdrawal_date: date,
      amount_ils: ils, chips_amount: chips, created_by: getDisplayName(), created_at: now()
    });
    document.getElementById('wd-chips').value = '';
    clearPlayerAC('wd-player');
    showNotif('✅ משיכה נוספה');
    closeSheet('wd-sheet');
    await loadWithdrawalsTable();
    refreshBTSummary();
  } catch (e) {
    showNotif('שגיאה: ' + e.message, 'error');
  }
}

// — General Expenses —
const EXPENSE_CATEGORIES = { subscription: 'מנוי אפליקציה', event: 'אירוע', other: 'אחר' };

function expenseCategoryLabel(r) {
  const label = EXPENSE_CATEGORIES[r.category] || r.category || '—';
  return r.category === 'other' && r.other_description ? `${label}: ${r.other_description}` : label;
}

function toggleExpenseOther() {
  const isOther = document.getElementById('exp-category').value === 'other';
  document.getElementById('exp-other-wrap').style.display = isOther ? '' : 'none';
}

async function loadExpensesTable() {
  try {
    const data = await dbGet('blue_table_expenses', '?order=created_at.desc');
    const tbody = document.getElementById('exp-table-body');
    if (!data || !data.length) {
      tbody.innerHTML = '<div class="md-list-empty">אין רשומות בתקופה הנוכחית</div>';
      setText('bt-exp-summary', '');
      return;
    }
    tbody.innerHTML = data.map(r => `
      <div class="md-list-item">
        <div class="md-list-content">
          <div class="md-list-title">${escHtml(r.description || '—')}</div>
          <div class="md-list-subtitle">${fmtDate(r.created_at)} · ${escHtml(expenseCategoryLabel(r))}</div>
        </div>
        <div class="md-list-trailing negative-color">₪${fmt(r.amount_ils)}</div>
        <button class="md-icon-btn" onclick="deleteRecord('blue_table_expenses','${r.id}','loadExpensesTable')" title="מחק">🗑️</button>
      </div>`).join('');
    const total = data.reduce((s, r) => s + n(r.amount_ils), 0);
    setText('bt-exp-summary', `סה"כ: ₪${fmt(total)}`);
  } catch (e) {
    showNotif('שגיאה בטעינת הוצאות: ' + e.message, 'error');
  }
}

async function addExpense() {
  const desc     = document.getElementById('exp-desc').value.trim();
  const amount   = parseFloat(document.getElementById('exp-amount').value);
  const category = document.getElementById('exp-category').value;
  const otherDesc = document.getElementById('exp-other-desc').value.trim();

  if (!desc)                 { showNotif('אנא הזן תיאור', 'error');          return; }
  if (!amount || amount <= 0){ showNotif('אנא הזן סכום תקין', 'error');       return; }
  if (category === 'other' && !otherDesc) { showNotif('אנא פרט את סוג ההוצאה', 'error'); return; }

  try {
    await dbPost('blue_table_expenses', {
      description: desc, amount_ils: amount, category,
      other_description: category === 'other' ? otherDesc : null,
      created_by: getDisplayName(), created_at: now()
    });
    document.getElementById('exp-desc').value = '';
    document.getElementById('exp-amount').value = '';
    document.getElementById('exp-other-desc').value = '';
    document.getElementById('exp-category').value = 'subscription';
    toggleExpenseOther();
    showNotif('✅ הוצאה נוספה');
    closeSheet('exp-sheet');
    await loadExpensesTable();
    refreshBTSummary();
  } catch (e) {
    showNotif('שגיאה: ' + e.message, 'error');
  }
}

// — Generic delete —
async function deleteRecord(table, id, reloadFnName) {
  try {
    await dbDelete(table, `?id=eq.${id}`);
    showNotif('✅ רשומה נמחקה');
    if (typeof window[reloadFnName] === 'function') await window[reloadFnName]();
    refreshBTSummary();
  } catch (e) {
    showNotif('שגיאה במחיקה: ' + e.message, 'error');
  }
}

// — Blue Table summary —
async function refreshBTSummary() {
  try {
    const [rb, tn, bn, ref, wd, exp] = await Promise.all([
      dbGet('blue_table_rakeback',   '?select=rakeback_amount'),
      dbGet('blue_table_tournaments','?select=prize_chips'),
      dbGet('blue_table_bonuses',    '?select=chips_amount'),
      dbGet('blue_table_referrals',  '?select=chips_amount'),
      dbGet('withdrawals',           '?select=amount_ils,chips_amount'),
      dbGet('blue_table_expenses',   '?select=amount_ils')
    ]);

    const sum = (arr, key) => (arr || []).reduce((s, r) => s + n(r[key]), 0);
    const sumRb    = sum(rb,  'rakeback_amount');
    const sumTn    = sum(tn,  'prize_chips');
    const sumBn    = sum(bn,  'chips_amount');
    const sumRef   = sum(ref, 'chips_amount');
    const sumWdIls   = sum(wd, 'amount_ils');
    const sumWdChips = sum(wd, 'chips_amount');
    const sumExp     = sum(exp, 'amount_ils');
    const totalChips = sumRb + sumTn + sumBn + sumRef;

    // Global summary bar
    setText('bt-total-ils',         '₪' + fmt(chipsToIls(totalChips)));
    setText('bt-total-withdrawals', '₪' + fmt(chipsToIls(sumWdChips)));

    // Per-tab summary rows (only if not already set by load functions)
    const upd = (id, txt) => { const el = document.getElementById(id); if (el && !el.textContent) el.textContent = txt; };
    upd('bt-rb-summary',  `סה"כ: ${fmt(sumRb)} צ' | ₪${fmt(chipsToIls(sumRb))}`);
    upd('bt-tn-summary',  `סה"כ: ${fmt(sumTn)} צ' | ₪${fmt(chipsToIls(sumTn))}`);
    upd('bt-bn-summary',  `סה"כ: ${fmt(sumBn)} צ' | ₪${fmt(chipsToIls(sumBn))}`);
    upd('bt-ref-summary', `סה"כ: ${fmt(sumRef)} צ' | ₪${fmt(chipsToIls(sumRef))}`);
    upd('bt-wd-summary',  `סה"כ: ₪${fmt(chipsToIls(sumWdChips))} | ${fmt(sumWdChips)} צ'`);
    upd('bt-exp-summary', `סה"כ: ₪${fmt(sumExp)}`);
    setText('bt-exp-total', '₪' + fmt(sumExp));

    // Dashboard card
    setText('dash-rb-sum',  `₪${fmt(chipsToIls(sumRb))}`);
    setText('dash-tn-sum',  `₪${fmt(chipsToIls(sumTn))}`);
    setText('dash-bn-sum',  `₪${fmt(chipsToIls(sumBn))}`);
    setText('dash-ref-sum', `₪${fmt(chipsToIls(sumRef))}`);
    setText('dash-wd-sum',  `₪${fmt(chipsToIls(sumWdChips))}`);
    setText('dash-exp-sum', `₪${fmt(sumExp)}`);

    // Dashboard expenses card
    setText('val-expenses-ils', fmt(chipsToIls(totalChips)));
  } catch {}
}

// ============================================================
// DASHBOARD — Blue Table Detail Modal
// ============================================================
function closeDashDetail() {
  closeSheet('dash-detail-overlay');
}

async function openDashBTDetail(type) {
  const cfg = {
    rb:  { title: '💸 החזרי גנייה',   table: 'blue_table_rakeback',   qs: '?order=created_at.desc&select=*,players(name,nickname)' },
    tn:  { title: '🏆 טורנירים',       table: 'blue_table_tournaments', qs: '?order=created_at.desc&select=*,players(name,nickname)' },
    bn:  { title: '🎁 בונוסים',        table: 'blue_table_bonuses',     qs: '?order=created_at.desc&select=*,players(name,nickname)' },
    ref: { title: '🤝 חבר מביא חבר',   table: 'blue_table_referrals',  qs: '?order=created_at.desc&select=id,chips_amount,created_at,referring_player_id,referred_player_id' },
    wd:  { title: '💳 משיכות',         table: 'withdrawals',            qs: '?order=created_at.desc&select=*,players(name,nickname)' },
    exp: { title: '🧾 הוצאות כלליות',  table: 'blue_table_expenses',   qs: '?order=created_at.desc' },
  }[type];
  if (!cfg) return;

  setText('dash-detail-title', cfg.title);
  const body = document.getElementById('dash-detail-body');
  openSheet('dash-detail-overlay');  // handles display:flex + .open class + animation
  body.innerHTML = '<div class="md-list-empty">טוען...</div>';

  try {
    const data = await dbGet(cfg.table, cfg.qs);
    if (!data || !data.length) {
      body.innerHTML = '<div class="md-list-empty">אין רשומות בתקופה הנוכחית</div>';
      return;
    }

    if (type === 'rb') {
      body.innerHTML = data.map(r => `
        <div class="md-list-item">
          <div class="md-list-content">
            <div class="md-list-title">${playerLabel(r.players?.name, r.players?.nickname)}</div>
            <div class="md-list-subtitle">${fmtDate(r.created_at)} · גנייה: ${fmt(r.rake_taken)} צ' · ${fmt(r.rakeback_percent)}%</div>
          </div>
          <div class="md-list-trailing chips-color">${fmt(r.rakeback_amount)} צ'</div>
        </div>`).join('');
    } else if (type === 'tn') {
      body.innerHTML = data.map(r => `
        <div class="md-list-item">
          <div class="md-list-content">
            <div class="md-list-title">${playerLabel(r.players?.name, r.players?.nickname)}</div>
            <div class="md-list-subtitle">${fmtDate(r.created_at)} · ${r.tournament_type === 'omaha' ? 'אומהה' : 'הולדם'}</div>
          </div>
          <div class="md-list-trailing chips-color">${fmt(r.prize_chips)} צ'</div>
        </div>`).join('');
    } else if (type === 'bn') {
      body.innerHTML = data.map(r => `
        <div class="md-list-item">
          <div class="md-list-content">
            <div class="md-list-title">${playerLabel(r.players?.name, r.players?.nickname)}</div>
            <div class="md-list-subtitle">${fmtDate(r.created_at)}${r.note ? ' · ' + escHtml(r.note) : ''}</div>
          </div>
          <div class="md-list-trailing chips-color">${fmt(r.chips_amount)} צ'</div>
        </div>`).join('');
    } else if (type === 'ref') {
      body.innerHTML = data.map(r => {
        const from = players.find(p => p.id === r.referring_player_id);
        const to   = players.find(p => p.id === r.referred_player_id);
        return `
        <div class="md-list-item">
          <div class="md-list-content">
            <div class="md-list-title">${playerLabel(from?.name, from?.nickname)} ← ${playerLabel(to?.name, to?.nickname)}</div>
            <div class="md-list-subtitle">${fmtDate(r.created_at)}</div>
          </div>
          <div class="md-list-trailing chips-color">${fmt(r.chips_amount)} צ'</div>
        </div>`;
      }).join('');
    } else if (type === 'wd') {
      body.innerHTML = data.map(r => `
        <div class="md-list-item">
          <div class="md-list-content">
            <div class="md-list-title">${playerLabel(r.players?.name, r.players?.nickname)}</div>
            <div class="md-list-subtitle">${r.withdrawal_date || fmtDate(r.created_at)} · ${fmt(r.chips_amount)} צ'</div>
          </div>
          <div class="md-list-trailing positive-color">₪${fmt(chipsToIls(r.chips_amount))}</div>
        </div>`).join('');
    } else if (type === 'exp') {
      body.innerHTML = data.map(r => `
        <div class="md-list-item">
          <div class="md-list-content">
            <div class="md-list-title">${escHtml(r.description || '—')}</div>
            <div class="md-list-subtitle">${fmtDate(r.created_at)} · ${escHtml(expenseCategoryLabel(r))}</div>
          </div>
          <div class="md-list-trailing negative-color">₪${fmt(r.amount_ils)}</div>
        </div>`).join('');
    }
  } catch (e) {
    body.innerHTML = '<div class="md-list-empty">שגיאה בטעינת הנתונים</div>';
  }
}

// ============================================================
// QUICK ADD-PLAYER (inline shortcut from tn/bn/wd sheets)
// ============================================================
let _quickAddPlayerTarget = null; // 'tn' | 'bn' | 'wd'

function openQuickAddPlayer(target) {
  _quickAddPlayerTarget = target;
  setVal('qap-name', '');
  setVal('qap-nickname', '');
  setVal('qap-rb', '60');
  openSheet('quick-player-overlay');
}

function closeQuickAddPlayer() {
  closeSheet('quick-player-overlay');
}

async function saveQuickPlayer() {
  const name     = (document.getElementById('qap-name')?.value || '').trim();
  const nickname = (document.getElementById('qap-nickname')?.value || '').trim();
  const rb       = parseFloat(document.getElementById('qap-rb')?.value) || 60;
  if (!name) { showNotif('שם חובה', 'error'); return; }

  try {
    const result = await dbPost('players', { name, nickname: nickname || null, rakeback_percent: rb, created_at: now() });
    if (result && result[0]) {
      players.push(result[0]);

      // Auto-select the new player in the source form
      const t = _quickAddPlayerTarget;
      if (t) {
        const wrap = document.getElementById(`${t}-player-wrap`);
        if (wrap) {
          wrap.querySelector('.player-ac-input').value = nickname || name;
          document.getElementById(`${t}-player`).value = result[0].id;
          acPlayerData[`${t}-player`] = result[0];
        }
      }
    }
    closeQuickAddPlayer();
    showNotif('✅ שחקן נוסף בהצלחה');
  } catch (e) {
    showNotif('שגיאה: ' + e.message, 'error');
  }
}

// ============================================================
// PAGE 4 — DEBTS
// ============================================================
async function loadDebts() {
  const cp = currentPeriod || {};
  setText('debt-ido-display',  fmt(n(cp.debt_ido)));
  setText('debt-maor-display', fmt(n(cp.debt_maor)));

  try { players = (await dbGet('players', '?order=name.asc')) || []; } catch {}
  initAllPlayerACs();
  renderOtherPlayerDebts();
}

function otherPlayersDebtTotal() {
  return (players || []).reduce((s, p) => s + (n(p.debt) > 0 ? n(p.debt) : 0), 0);
}

function renderOtherPlayerDebts() {
  const container = document.getElementById('other-debts-grid');
  if (!container) return;
  const withDebt = (players || []).filter(p => n(p.debt) > 0);
  container.innerHTML = withDebt.map(p => `
    <div class="debt-block">
      <h3>⚖️ חוב ${escHtml(p.nickname || p.name)}</h3>
      <div class="debt-amount">
        <span class="debt-currency">₪</span>${fmt(p.debt)}
      </div>
    </div>`).join('');
}

async function manualPlayerDebt(sign) {
  const playerId = document.getElementById('pd-player').value;
  const inputEl  = document.getElementById('pd-player-amount');
  const amount   = parseFloat(inputEl.value);
  if (!playerId)              { showNotif('אנא בחר שחקן', 'error');        return; }
  if (!amount || amount <= 0) { showNotif('אנא הזן סכום תקין', 'error');    return; }

  const p = players.find(pl => pl.id === playerId);
  if (!p) return;
  const newVal = Math.max(0, n(p.debt) + sign * amount);

  try {
    await dbPatch('players', `?id=eq.${playerId}`, { debt: newVal });
    p.debt = newVal;
    inputEl.value = '';
    clearPlayerAC('pd-player');
    showNotif(`✅ חוב ${p.nickname || p.name} עודכן → ₪${fmt(newVal)}`);
    closeSheet('debt-sheet');
    renderOtherPlayerDebts();
  } catch (e) {
    showNotif('שגיאה בעדכון חוב: ' + e.message, 'error');
  }
}

async function quickDebt(person, amount) {
  const field  = `debt_${person}`;
  const newVal = Math.max(0, n(currentPeriod[field]) + amount);
  await _updateDebt(person, newVal);
}

async function manualDebt(person, sign) {
  const inputEl = document.getElementById(`debt-${person}-manual`);
  const amount  = parseFloat(inputEl.value);
  if (!amount || amount <= 0) { showNotif('אנא הזן סכום תקין', 'error'); return; }
  const field  = `debt_${person}`;
  const newVal = Math.max(0, n(currentPeriod[field]) + sign * amount);
  await _updateDebt(person, newVal);
  inputEl.value = '';
}

async function _updateDebt(person, newVal) {
  const field = `debt_${person}`;
  const delta = newVal - n(currentPeriod[field]);
  try {
    await dbPatch('current_period', '?id=eq.1', { [field]: newVal, updated_at: now() });
    currentPeriod[field] = newVal;
    setText(`debt-${person}-display`, fmt(newVal));

    // Keep funds page readonly fields in sync if they exist
    const fundsEl = document.getElementById(`funds-debt_${person}`);
    if (fundsEl) fundsEl.value = newVal;

    showNotif(`✅ חוב ${person === 'ido' ? 'עידו' : 'מאור'} עודכן → ₪${fmt(newVal)}`);

    if (delta !== 0) {
      try {
        await dbPost('debt_log', { person, amount: delta, created_by: getDisplayName(), created_at: now() });
      } catch {}
    }
  } catch (e) {
    showNotif('שגיאה בעדכון חוב: ' + e.message, 'error');
  }
}

// — Debt log —
let debtLogFilter = null; // null = all, 'ido', 'maor'

async function openDebtLog() {
  debtLogFilter = null;
  document.getElementById('debt-log-overlay').style.display = 'flex';
  await loadDebtLogData();
}

function setDebtLogFilter(person) {
  debtLogFilter = person;
  document.querySelectorAll('#debt-log-filter .chart-toggle-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.person === (person || 'all'))
  );
  loadDebtLogData();
}

async function loadDebtLogData() {
  const body = document.getElementById('debt-log-body');
  body.innerHTML = '<div class="pd-empty">טוען נתונים...</div>';

  try {
    const query = debtLogFilter
      ? `?person=eq.${debtLogFilter}&order=created_at.desc&limit=10`
      : '?order=created_at.desc&limit=10';
    const data = await dbGet('debt_log', query);
    if (!data || !data.length) {
      body.innerHTML = '<p class="pd-empty">אין פעולות</p>';
      return;
    }
    body.innerHTML = `<div class="table-container"><table>
      <thead><tr><th>תאריך</th><th>שם</th><th>סכום</th><th>הוזן ע"י</th></tr></thead>
      <tbody>${data.map(r => {
        const amt   = n(r.amount);
        const color = amt >= 0 ? 'negative-color' : 'positive-color';
        const sign  = amt >= 0 ? '+' : '';
        return `<tr>
          <td>${fmtDate(r.created_at)}</td>
          <td>${r.person === 'ido' ? 'עידו' : 'מאור'}</td>
          <td class="${color}"><strong>${sign}₪${fmt(amt)}</strong></td>
          <td>${r.created_by || '—'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  } catch (e) {
    body.innerHTML = `<p class="pd-empty">שגיאה בטעינת הנתונים: ${e.message}</p>`;
  }
}

function closeDebtLog(e) {
  if (e && e.target !== document.getElementById('debt-log-overlay')) return;
  document.getElementById('debt-log-overlay').style.display = 'none';
}

// ============================================================
// PAGE 5 — HISTORY & GRAPHS
// ============================================================
async function loadHistory() {
  try {
    const data = await dbGet('history', '?order=period_end.desc');
    historyData = data || [];
    renderHistoryTable(historyData);
    renderYearFilterButtons();
    renderProfitChart();
  } catch (e) {
    showNotif('שגיאה בטעינת היסטוריה: ' + e.message, 'error');
  }
}

function renderHistoryTable(data) {
  const tbody = document.getElementById('history-table-body');
  if (!data.length) {
    tbody.innerHTML = '<div class="md-list-empty">אין נתוני היסטוריה</div>';
    return;
  }
  tbody.innerHTML = data.map(r => {
    const profitColor    = n(r.profit_total) >= 0 ? 'positive-color' : 'negative-color';
    const perPersonColor = (n(r.profit_total) / 2) >= 0 ? 'positive-color' : 'negative-color';
    const expensesIls    = chipsToIls(r.total_expenses_chips, historyRatio(r));
    return `
    <div class="md-list-item" style="cursor:pointer" onclick='openPeriodDetail(${JSON.stringify(r).replace(/'/g,"&#39;")})'>
      <div class="md-list-content">
        <div class="md-list-title">${r.period_end || '—'}</div>
        <div class="md-list-subtitle">הוצ' ₪${fmt(expensesIls)} · משיכות ₪${fmt(r.total_withdrawals_ils)}${r.notes ? ' · ' + r.notes : ''}</div>
      </div>
      <div style="text-align:left;flex-shrink:0">
        <div class="md-list-trailing ${profitColor}">₪${fmt(r.profit_total)}</div>
        <div style="font-size:11px;color:var(--text-secondary);text-align:left">לאחד: <span class="${perPersonColor}">₪${fmt(n(r.profit_total)/2)}</span></div>
      </div>
    </div>`;
  }).join('');
}

function setChartMode(mode) {
  chartMode = mode;
  document.getElementById('chart-mode-person')?.classList.toggle('active', mode === 'person');
  document.getElementById('chart-mode-total')?.classList.toggle('active',  mode === 'total');
  renderProfitChart();
}

function setChartFilter(months) {
  chartMonths = months;
  chartYear   = null;
  ['3','6','12','all'].forEach(k => {
    const el = document.getElementById('chart-filter-' + k);
    if (el) el.classList.toggle('active', k === (months === null ? 'all' : String(months)));
  });
  document.querySelectorAll('#chart-year-group .chart-toggle-btn').forEach(b => b.classList.remove('active'));
  renderProfitChart();
}

function renderYearFilterButtons() {
  const container = document.getElementById('chart-year-group');
  if (!container) return;
  const years = [...new Set(
    historyData.map(r => r.period_end && new Date(r.period_end).getFullYear()).filter(Boolean)
  )].sort((a, b) => a - b);
  container.innerHTML = years.map(y =>
    `<button class="chart-toggle-btn${chartYear === y ? ' active' : ''}" onclick="setChartYear(${y})">${y}</button>`
  ).join('');
}

function setChartYear(year) {
  chartYear   = year;
  chartMonths = null;
  document.querySelectorAll('#chart-year-group .chart-toggle-btn').forEach(b =>
    b.classList.toggle('active', b.textContent.trim() === String(year))
  );
  ['3','6','12','all'].forEach(k => document.getElementById('chart-filter-' + k)?.classList.remove('active'));
  renderProfitChart();
}

function renderProfitChart() {
  const ctx = document.getElementById('profit-chart');
  if (!ctx) return;

  if (profitChart) { profitChart.destroy(); profitChart = null; }
  if (!historyData.length) return;

  // Sort ascending by date
  let sorted = [...historyData].sort((a, b) => new Date(a.period_end) - new Date(b.period_end));

  // Apply year or month filter (mutually exclusive)
  if (chartYear !== null) {
    sorted = sorted.filter(r => r.period_end && new Date(r.period_end).getFullYear() === chartYear);
  } else if (chartMonths !== null) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - chartMonths);
    sorted = sorted.filter(r => new Date(r.period_end) >= cutoff);
  }

  const isPersonMode = chartMode === 'person';
  const labels  = sorted.map(r => r.period_end || '');
  const profits = sorted.map(r => isPersonMode ? n(r.profit_total) / 2 : n(r.profit_total));

  // Cumulative sum
  const cumulative = profits.reduce((sum, v) => sum + v, 0);
  const cumulEl = document.getElementById('chart-cumulative');
  if (cumulEl) {
    cumulEl.textContent = '₪' + fmt(cumulative);
    cumulEl.style.color = cumulative >= 0 ? 'var(--positive)' : 'var(--negative)';
  }

  const chartLabel = isPersonMode ? 'רווח לאחד (₪)' : 'רווח כולל (₪)';

  profitChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: chartLabel,
        data: profits,
        borderColor: '#6c63ff',
        backgroundColor: 'rgba(108,99,255,0.08)',
        borderWidth: 2.5,
        pointBackgroundColor: profits.map(v => v >= 0 ? '#00d4aa' : '#ff4757'),
        pointRadius: 6,
        pointHoverRadius: 8,
        tension: 0.35,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: c => '₪' + fmt(c.raw)
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#9090b0', font: { family: 'Heebo' } },
          grid:  { color: '#2a2a45' }
        },
        y: {
          ticks: { color: '#9090b0', font: { family: 'Heebo' }, callback: v => '₪' + fmt(v) },
          grid:  { color: '#2a2a45' }
        }
      }
    }
  });
}

function autoSplitProfit() {
  const total = parseFloat(document.getElementById('hist-profit-total').value) || 0;
  setVal('hist-profit-ido',  (total / 2).toFixed(2));
  setVal('hist-profit-maor', (total / 2).toFixed(2));
}

async function importHistory() {
  const start    = document.getElementById('hist-start').value;
  const end      = document.getElementById('hist-end').value;
  const expenses = parseFloat(document.getElementById('hist-expenses').value) || 0;
  const wds      = parseFloat(document.getElementById('hist-withdrawals').value) || 0;
  const pTotal   = parseFloat(document.getElementById('hist-profit-total').value) || 0;
  const pIdo     = parseFloat(document.getElementById('hist-profit-ido').value) || 0;
  const pMaor    = parseFloat(document.getElementById('hist-profit-maor').value) || 0;
  const notes    = document.getElementById('hist-notes').value.trim();

  if (!end) { showNotif('אנא הזן תאריך סיום', 'error'); return; }

  try {
    await dbPost('history', {
      period_start: start || null,
      period_end: end,
      total_expenses_chips: expenses,
      total_withdrawals_ils: wds,
      profit_total: pTotal,
      profit_ido: pIdo,
      profit_maor: pMaor,
      entry_type: 'manual_import',
      closed_by: getDisplayName(),
      notes: notes || null
    });

    ['hist-start','hist-end','hist-expenses','hist-withdrawals',
     'hist-profit-total','hist-profit-ido','hist-profit-maor','hist-notes']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

    showNotif('✅ תקופה היסטורית נשמרה');
    await loadHistory();
  } catch (e) {
    showNotif('שגיאה בשמירה: ' + e.message, 'error');
  }
}

async function deleteHistory(id) {
  try {
    await dbDelete('history', `?id=eq.${id}`);
    showNotif('✅ רשומה נמחקה מההיסטוריה');
    await loadHistory();
  } catch (e) {
    showNotif('שגיאה במחיקה: ' + e.message, 'error');
  }
}

// ============================================================
// PERIOD DETAIL MODAL
// ============================================================
function openPeriodDetail(r) {
  const title = document.getElementById('pd-title');
  const body  = document.getElementById('pd-body');
  if (!title || !body) return;

  title.textContent = `פרטי תקופה — ${r.period_end || ''}`;

  const section = (icon, label, html) =>
    html ? `<div class="pd-section"><div class="pd-section-title">${icon} ${label}</div>${html}</div>` : '';

  const miniTable = (headers, rows) => {
    if (!rows || !rows.length) return '<p class="pd-empty">אין רשומות</p>';
    const ths = headers.map(h => `<th>${h}</th>`).join('');
    const trs = rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    return `<div class="table-container"><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
  };

  // Counter + BadBeat
  const _hRatio = historyRatio(r);
  const counterHtml = r.counter_snapshot
    ? `<div class="pd-stat">Counter: <strong>${fmt(n(r.counter_snapshot))} צ'</strong> = <strong>₪${fmt(chipsToIls(r.counter_snapshot, _hRatio))}</strong></div>`
    : '';
  const bbSnap = n(r.badbeat_snapshot);
  const badBeatHtml = bbSnap > 0
    ? `<div class="pd-stat">BadBeat: <strong>${fmt(bbSnap)} צ'</strong> = <strong>₪${fmt(chipsToIls(bbSnap, _hRatio))}</strong></div>`
    : '';

  // Summary
  const summaryHtml = `<div class="pd-stat-grid">
    <div class="pd-stat-item"><span>רווח כולל</span><strong class="${n(r.profit_total)>=0?'positive-color':'negative-color'}">₪${fmt(r.profit_total)}</strong></div>
    <div class="pd-stat-item"><span>רווח לאחד</span><strong class="${n(r.profit_total)>=0?'positive-color':'negative-color'}">₪${fmt(n(r.profit_total)/2)}</strong></div>
    <div class="pd-stat-item"><span>הוצאות</span><strong>₪${fmt(chipsToIls(r.total_expenses_chips, _hRatio))}</strong></div>
    <div class="pd-stat-item"><span>משיכות</span><strong>₪${fmt(r.total_withdrawals_ils)}</strong></div>
    <div class="pd-stat-item"><span>הוצאות כלליות</span><strong>₪${fmt(n(r.total_general_expenses_ils))}</strong></div>
  </div>`;

  // Withdrawals
  const wdHtml = miniTable(
    ['שחקן','סכום (₪)','תאריך'],
    (r.detail_withdrawals || []).map(x => [x.player, `₪${fmt(x.amount_ils)}`, x.date || ''])
  );

  // Rakeback
  const rbHtml = miniTable(
    ['שחקן','צ\'יפים','₪'],
    (r.detail_rakeback || []).map(x => [x.player, fmt(x.rakeback_chips), `₪${fmt(x.rakeback_ils)}`])
  );

  // Tournaments
  const tnHtml = miniTable(
    ['שחקן','פרס (צ\')','פרס (₪)'],
    (r.detail_tournaments || []).map(x => [x.player, fmt(x.prize_chips), `₪${fmt(x.prize_ils)}`])
  );

  // Bonuses
  const bnHtml = miniTable(
    ['שחקן','צ\'יפים','₪','הערה'],
    (r.detail_bonuses || []).map(x => [x.player, fmt(x.chips), `₪${fmt(x.ils)}`, x.note || '—'])
  );

  // Referrals
  const refHtml = miniTable(
    ['מפנה','מופנה','צ\'יפים'],
    (r.detail_referrals || []).map(x => [x.referring, x.referred, fmt(x.chips)])
  );

  // General expenses
  const expHtml = miniTable(
    ['תיאור','מהות','סכום (₪)'],
    (r.detail_expenses || []).map(x => [x.description || '—', expenseCategoryLabel(x), `₪${fmt(x.amount_ils)}`])
  );

  body.innerHTML =
    summaryHtml +
    ((counterHtml || badBeatHtml) ? `<div class="pd-section">${counterHtml}${badBeatHtml}</div>` : '') +
    section('💳','משיכות',         wdHtml)  +
    section('💸','החזר גנייה',     rbHtml)  +
    section('🏆','טורנירים',       tnHtml)  +
    section('🎁','בונוס צ\'יפים',  bnHtml)  +
    section('🤝','חבר מביא חבר',  refHtml) +
    section('🧾','הוצאות כלליות', expHtml);

  document.getElementById('period-detail-overlay').style.display = 'flex';
}

function closePeriodDetail(e) {
  if (e && e.target !== document.getElementById('period-detail-overlay')) return;
  document.getElementById('period-detail-overlay').style.display = 'none';
}

// ============================================================
// PLAYER STATS MODAL
// ============================================================
async function openPlayerStats(playerId, playerName) {
  const title = document.getElementById('ps-title');
  const body  = document.getElementById('ps-body');
  if (!title || !body) return;

  title.textContent = `סטטיסטיקות — ${playerName}`;
  body.innerHTML = '<div class="pd-empty">טוען נתונים...</div>';
  document.getElementById('player-stats-overlay').style.display = 'flex';

  try {
    const allHistory = await dbGet('history',
      '?order=period_end.desc&select=period_end,detail_rakeback,detail_tournaments,detail_bonuses,detail_referrals,detail_withdrawals');

    // Aggregate per-player data across all periods
    const rows = [];
    let totals = { withdrawals: 0, rakeback_chips: 0, tournament_chips: 0, bonus_chips: 0, referral_chips: 0 };

    (allHistory || []).forEach(h => {
      const date = h.period_end || '';
      const matchName = s => s && s.toLowerCase() === playerName.toLowerCase();

      (h.detail_withdrawals || []).filter(x => matchName(x.player)).forEach(x => {
        rows.push({ date, category: '💳 משיכה', detail: `₪${fmt(x.amount_ils)}` });
        totals.withdrawals += n(x.amount_ils);
      });
      (h.detail_rakeback || []).filter(x => matchName(x.player)).forEach(x => {
        rows.push({ date, category: '💸 החזר גנייה', detail: `${fmt(x.rakeback_chips)} צ' (₪${fmt(x.rakeback_ils)})` });
        totals.rakeback_chips += n(x.rakeback_chips);
      });
      (h.detail_tournaments || []).filter(x => matchName(x.player)).forEach(x => {
        rows.push({ date, category: '🏆 טורניר', detail: `${fmt(x.prize_chips)} צ' (₪${fmt(x.prize_ils)})` });
        totals.tournament_chips += n(x.prize_chips);
      });
      (h.detail_bonuses || []).filter(x => matchName(x.player)).forEach(x => {
        const noteTxt = x.note ? ` — ${x.note}` : '';
        rows.push({ date, category: '🎁 בונוס', detail: `${fmt(x.chips)} צ' (₪${fmt(x.ils)})${noteTxt}` });
        totals.bonus_chips += n(x.chips);
      });
      (h.detail_referrals || []).filter(x => matchName(x.referring) || matchName(x.referred)).forEach(x => {
        const role = matchName(x.referring) ? `הפנה את ${x.referred}` : `הופנה ע"י ${x.referring}`;
        rows.push({ date, category: '🤝 חבר מביא חבר', detail: `${role} — ${fmt(x.chips)} צ'` });
        if (matchName(x.referring)) totals.referral_chips += n(x.chips);
      });
    });

    const totalsHtml = `<div class="pd-stat-grid">
      <div class="pd-stat-item"><span>💳 סה"כ משיכות</span><strong>₪${fmt(totals.withdrawals)}</strong></div>
      <div class="pd-stat-item"><span>💸 החזר גנייה</span><strong>${fmt(totals.rakeback_chips)} צ'</strong></div>
      <div class="pd-stat-item"><span>🏆 טורנירים</span><strong>${fmt(totals.tournament_chips)} צ'</strong></div>
      <div class="pd-stat-item"><span>🎁 בונוסים</span><strong>${fmt(totals.bonus_chips)} צ'</strong></div>
    </div>`;

    let tableHtml = '';
    if (rows.length) {
      tableHtml = `<div class="pd-section"><div class="pd-section-title">📅 היסטוריה מפורטת</div>
        <div class="table-container"><table>
          <thead><tr><th>תאריך</th><th>קטגוריה</th><th>פרטים</th></tr></thead>
          <tbody>${rows.map(r => `<tr><td>${r.date}</td><td>${r.category}</td><td>${r.detail}</td></tr>`).join('')}</tbody>
        </table></div></div>`;
    } else {
      tableHtml = '<div class="pd-empty">אין נתונים היסטוריים לשחקן זה עדיין</div>';
    }

    body.innerHTML = `<div class="pd-section">${totalsHtml}</div>` + tableHtml;

  } catch (e) {
    body.innerHTML = `<div class="pd-empty">שגיאה: ${e.message}</div>`;
  }
}

function closePlayerStats(e) {
  if (e && e.target !== document.getElementById('player-stats-overlay')) return;
  document.getElementById('player-stats-overlay').style.display = 'none';
}

// ============================================================
// PAGE 6 — PLAYERS
// ============================================================
const WITHDRAWAL_LABELS = {
  bit:           '💳 ביט',
  paybox:        '📱 פייבוקס',
  cashcash:      '💰 קאשקאש',
  bank_transfer: '🏦 העברה בנקאית'
};

async function loadPlayers() {
  try {
    players = (await dbGet('players', '?order=name.asc')) || [];
    renderPlayersTable();
  } catch (e) {
    showNotif('שגיאה בטעינת שחקנים: ' + e.message, 'error');
  }
}

function getPlayersSearchQuery() {
  return (document.getElementById('players-search')?.value || '').trim().toLowerCase();
}

function getFilteredPlayers() {
  const q = getPlayersSearchQuery();
  if (!q) return [...players];
  return players.filter(p =>
    (p.name || '').toLowerCase().includes(q) ||
    (p.nickname || '').toLowerCase().includes(q)
  );
}

function filterPlayersList() {
  renderPlayersTable();
}

function renderPlayersTable() {
  const tbody      = document.getElementById('players-table-body');
  const cardsBody  = document.getElementById('players-cards-body');
  const countEl    = document.getElementById('players-count');
  const filtered   = getFilteredPlayers();
  const q          = getPlayersSearchQuery();

  if (countEl) {
    countEl.textContent = q ? `${filtered.length}/${players.length}` : String(players.length);
  }

  if (!players.length) {
    tbody.innerHTML     = '<tr><td colspan="6" class="empty-state">אין שחקנים רשומים</td></tr>';
    cardsBody.innerHTML = '<div class="empty-state">אין שחקנים רשומים</div>';
    return;
  }

  if (!filtered.length) {
    tbody.innerHTML     = '<tr><td colspan="6" class="empty-state">לא נמצאו שחקנים תואמים</td></tr>';
    cardsBody.innerHTML = '<div class="empty-state">לא נמצאו שחקנים תואמים</div>';
    return;
  }

  // — Desktop table rows —
  tbody.innerHTML = filtered.map(p => {
    const rb    = rakebackCellLabel(p);
    const wdLbl = WITHDRAWAL_LABELS[p.preferred_withdrawal] || '—';
    return `
    <tr id="pr-${p.id}">
      <td><strong>${escHtml(p.name)}</strong></td>
      <td style="color:var(--text-secondary)">${escHtml(p.nickname || '—')}</td>
      <td>${rb}</td>
      <td>${wdLbl}</td>
      <td style="color:var(--text-muted)">${fmtDate(p.created_at)}</td>
      <td>
        <div class="action-row">
          <button class="btn btn-secondary btn-xs" onclick="openEditModal('${p.id}')">✏️ ערוך</button>
          <button class="btn btn-secondary btn-xs" onclick="openPlayerStats('${p.id}','${escHtml(p.nickname||p.name)}')">📊</button>
          <button class="btn btn-danger btn-xs" onclick="deletePlayer('${p.id}')">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  // — Mobile player cards —
  cardsBody.innerHTML = filtered.map(p => {
    const rb    = rakebackCellLabel(p);
    const wdLbl = WITHDRAWAL_LABELS[p.preferred_withdrawal] || '—';
    return `
    <div class="md-list-item" style="flex-direction:column;align-items:stretch;gap:8px">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="md-list-content">
          <div class="md-list-title">${escHtml(p.name)}${p.nickname ? ` <span style="font-weight:400;color:var(--text-secondary)">"${escHtml(p.nickname)}"</span>` : ''}</div>
          <div class="md-list-subtitle">החזר גנייה: ${rb} · ${wdLbl}</div>
        </div>
        <button class="md-icon-btn" style="color:var(--text-secondary);font-size:15px" onclick="openPlayerStats('${p.id}','${escHtml(p.nickname||p.name)}')" title="סטטיסטיקות">📊</button>
        <button class="md-icon-btn" style="color:var(--accent);font-size:15px" onclick="openEditModal('${p.id}')" title="ערוך">✏️</button>
        <button class="md-icon-btn" onclick="deletePlayer('${p.id}')" title="מחק">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function openAddPlayerModal() {
  const existing = document.getElementById('add-player-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'add-player-modal';
  modal.className = 'confirm-overlay';
  modal.innerHTML = `
    <div class="confirm-dialog" style="max-width:480px;text-align:right">
      <h3 style="color:var(--accent);margin-bottom:20px">➕ הוסף שחקן חדש</h3>
      <div class="form-group">
        <label>שם מלא <span class="required">*</span></label>
        <input type="text" id="ap-name" placeholder="ישראל ישראלי"
               onkeydown="if(event.key==='Enter') addPlayer()">
      </div>
      <div class="form-group">
        <label>כינוי</label>
        <input type="text" id="ap-nickname" placeholder="ניק / שם בשולחן...">
      </div>
      <div class="form-group">
        <label>אחוז החזר גנייה (%)</label>
        <input type="number" id="ap-rakeback" placeholder="0" min="0" max="100">
        <span class="field-hint">השאר ריק אם אין החזר גנייה</span>
      </div>
      <div class="form-group">
        <label>החזר גנייה בתוקף עד</label>
        <input type="date" id="ap-rakeback-until">
        <span class="field-hint">השאר ריק אם ללא תאריך תפוגה</span>
      </div>
      <div class="form-group">
        <label>אופן משיכה מועדף</label>
        <select id="ap-withdrawal">
          <option value="bit">💳 ביט</option>
          <option value="paybox">📱 פייבוקס</option>
          <option value="cashcash">💰 קאשקאש</option>
          <option value="bank_transfer">🏦 העברה בנקאית</option>
        </select>
      </div>
      <div class="confirm-buttons" style="margin-top:20px">
        <button class="btn btn-success" onclick="addPlayer()">➕ הוסף שחקן</button>
        <button class="btn btn-secondary" onclick="closeAddPlayerModal()">ביטול</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('ap-name').focus();
}

function closeAddPlayerModal() {
  document.getElementById('add-player-modal')?.remove();
}

// Edit modal
function openEditModal(id) {
  const p = players.find(pl => pl.id === id);
  if (!p) return;

  // Remove existing modal if any
  const existing = document.getElementById('edit-player-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'edit-player-modal';
  modal.className = 'confirm-overlay';
  modal.innerHTML = `
    <div class="confirm-dialog" style="max-width:480px;text-align:right">
      <h3 style="color:var(--accent);margin-bottom:20px">✏️ עריכת שחקן</h3>
      <div class="form-group">
        <label>שם מלא <span class="required">*</span></label>
        <input type="text" id="ep-name" value="${escHtml(p.name)}" placeholder="שם מלא...">
      </div>
      <div class="form-group">
        <label>כינוי</label>
        <input type="text" id="ep-nickname" value="${escHtml(p.nickname || '')}" placeholder="כינוי / ניק...">
      </div>
      <div class="form-group">
        <label>אחוז החזר גנייה (%)</label>
        <input type="number" id="ep-rakeback" value="${p.rakeback_percent ?? ''}" min="0" max="100" placeholder="השאר ריק אם אין">
      </div>
      <div class="form-group">
        <label>החזר גנייה בתוקף עד</label>
        <input type="date" id="ep-rakeback-until" value="${p.rakeback_until || ''}">
        <span class="field-hint">השאר ריק אם ללא תאריך תפוגה</span>
      </div>
      <div class="form-group">
        <label>אופן משיכה מועדף</label>
        <select id="ep-withdrawal">
          <option value="bit"           ${p.preferred_withdrawal==='bit'           ?'selected':''}>💳 ביט</option>
          <option value="paybox"        ${p.preferred_withdrawal==='paybox'        ?'selected':''}>📱 פייבוקס</option>
          <option value="cashcash"      ${p.preferred_withdrawal==='cashcash'      ?'selected':''}>💰 קאשקאש</option>
          <option value="bank_transfer" ${p.preferred_withdrawal==='bank_transfer' ?'selected':''}>🏦 העברה בנקאית</option>
        </select>
      </div>
      <div class="confirm-buttons" style="margin-top:20px">
        <button class="btn btn-success" onclick="savePlayer('${id}')">💾 שמור</button>
        <button class="btn btn-secondary" onclick="document.getElementById('edit-player-modal').remove()">ביטול</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('ep-name').focus();
}

async function savePlayer(id) {
  const name       = document.getElementById('ep-name')?.value.trim();
  const nickname   = document.getElementById('ep-nickname')?.value.trim() || null;
  const rbVal      = document.getElementById('ep-rakeback')?.value;
  const rb         = rbVal !== '' ? parseFloat(rbVal) : null;
  const rbUntil    = document.getElementById('ep-rakeback-until')?.value || null;
  const withdrawal = document.getElementById('ep-withdrawal')?.value || 'bit';

  if (!name) { showNotif('אנא הזן שם שחקן', 'error'); return; }
  if (rb !== null && (isNaN(rb) || rb < 0 || rb > 100)) {
    showNotif('אחוז החזר חייב להיות 0–100', 'error'); return;
  }

  try {
    await dbPatch('players', `?id=eq.${id}`, {
      name, nickname, rakeback_percent: rb, rakeback_until: rbUntil, preferred_withdrawal: withdrawal
    });
    const p = players.find(pl => pl.id === id);
    if (p) Object.assign(p, { name, nickname, rakeback_percent: rb, rakeback_until: rbUntil, preferred_withdrawal: withdrawal });

    document.getElementById('edit-player-modal')?.remove();
    renderPlayersTable();
    showNotif('✅ שחקן עודכן בהצלחה');
  } catch (e) {
    showNotif('שגיאה: ' + e.message, 'error');
  }
}

async function addPlayer() {
  const name       = document.getElementById('ap-name')?.value.trim();
  const nickname   = document.getElementById('ap-nickname')?.value.trim() || null;
  const rbVal      = document.getElementById('ap-rakeback')?.value;
  const rb         = rbVal !== '' ? parseFloat(rbVal) : null;
  const rbUntil    = document.getElementById('ap-rakeback-until')?.value || null;
  const withdrawal = document.getElementById('ap-withdrawal')?.value || 'bit';

  if (!name) { showNotif('אנא הזן שם שחקן', 'error'); return; }
  if (rb !== null && (isNaN(rb) || rb < 0 || rb > 100)) {
    showNotif('אחוז החזר חייב להיות 0–100', 'error'); return;
  }

  try {
    const result = await dbPost('players', {
      name, nickname, rakeback_percent: rb, rakeback_until: rbUntil,
      preferred_withdrawal: withdrawal, created_at: now()
    });
    if (result && result[0]) players.push(result[0]);

    closeAddPlayerModal();
    renderPlayersTable();
    showNotif('✅ שחקן נוסף בהצלחה');
  } catch (e) {
    showNotif('שגיאה: ' + e.message, 'error');
  }
}

async function deletePlayer(id) {
  try {
    await dbDelete('players', `?id=eq.${id}`);
    players = players.filter(p => p.id !== id);
    renderPlayersTable();
    showNotif('✅ שחקן נמחק');
  } catch (e) {
    showNotif('שגיאה: ' + e.message, 'error');
  }
}

// ============================================================
// CLOSE PERIOD
// ============================================================
function confirmClosePeriod() {
  document.getElementById('confirm-title').textContent = '⚠️ סגירת תקופה';
  document.getElementById('confirm-msg').innerHTML =
    'פעולה זו תשמור את נתוני התקופה הנוכחית בהיסטוריה ותאפס את כל הנתונים.<br>' +
    '<strong style="color:var(--negative)">פעולה זו בלתי הפיכה!</strong><br><br>' +
    '<label for="close-period-start-date">תאריך תחילת התקופה</label><br>' +
    `<input type="date" id="close-period-start-date" max="${yesterday()}">`;
  document.getElementById('confirm-ok').onclick = () => {
    const dateVal = document.getElementById('close-period-start-date')?.value;
    if (!dateVal)          { showNotif('אנא הזן תאריך תחילת תקופה', 'error');        return; }
    if (dateVal >= today()){ showNotif('התאריך חייב להיות קטן מהיום הנוכחי', 'error'); return; }
    closeConfirm();
    closePeriod(dateVal);
  };
  document.getElementById('confirm-overlay').style.display = 'flex';
}

function closeConfirm() {
  document.getElementById('confirm-overlay').style.display = 'none';
}

async function closePeriod(periodStart) {
  showNotif('⏳ מבצע סגירת תקופה...', 'info');
  try {
    // 1. Fetch full detail from all blue tables (with player names)
    const [rb, tn, bn, ref, wd, exp] = await Promise.all([
      dbGet('blue_table_rakeback',   '?select=*,players(name,nickname)&order=created_at.asc'),
      dbGet('blue_table_tournaments','?select=*,players(name,nickname)&order=created_at.asc'),
      dbGet('blue_table_bonuses',    '?select=*,players(name,nickname)&order=created_at.asc'),
      dbGet('blue_table_referrals',  '?select=id,chips_amount,created_at,referring_player_id,referred_player_id'),
      dbGet('withdrawals',           '?select=*,players(name,nickname)&order=created_at.asc'),
      dbGet('blue_table_expenses',   '?order=created_at.asc')
    ]);

    const sumField    = (arr, key) => (arr || []).reduce((s, r) => s + n(r[key]), 0);
    const playerLabel = p => p?.nickname || p?.name || '—';

    // Build JSONB detail snapshots
    const detailRakeback = (rb || []).map(r => ({
      player: playerLabel(r.players),
      rakeback_chips: n(r.rakeback_amount),
      rakeback_ils:   chipsToIls(r.rakeback_amount),
      date: israelDateFromTimestamp(r.created_at)
    }));

    const detailTournaments = (tn || []).map(r => ({
      player:      playerLabel(r.players),
      prize_chips: n(r.prize_chips),
      prize_ils:   chipsToIls(r.prize_chips),
      date: israelDateFromTimestamp(r.created_at)
    }));

    const detailBonuses = (bn || []).map(r => ({
      player:      playerLabel(r.players),
      chips:       n(r.chips_amount),
      ils:         chipsToIls(r.chips_amount),
      note:        r.note || '',
      date: israelDateFromTimestamp(r.created_at)
    }));

    const detailReferrals = (ref || []).map(r => {
      const from = players.find(p => p.id === r.referring_player_id);
      const to   = players.find(p => p.id === r.referred_player_id);
      return {
        referring: playerLabel(from),
        referred:  playerLabel(to),
        chips:     n(r.chips_amount),
        date: israelDateFromTimestamp(r.created_at)
      };
    });

    const detailWithdrawals = (wd || []).map(r => ({
      player: playerLabel(r.players),
      amount_ils: n(r.amount_ils),
      method: r.method || '',
      date: israelDateFromTimestamp(r.created_at)
    }));

    const detailExpenses = (exp || []).map(r => ({
      description: r.description,
      category: r.category,
      other_description: r.other_description || '',
      amount_ils: n(r.amount_ils),
      date: israelDateFromTimestamp(r.created_at)
    }));

    const totalExpenses = sumField(rb,'rakeback_amount') + sumField(tn,'prize_chips') +
                          sumField(bn,'chips_amount')    + sumField(ref,'chips_amount');
    const totalWd = (wd || []).reduce((s, r) => s + chipsToIls(r.chips_amount), 0);
    const totalGeneralExpenses = sumField(exp, 'amount_ils');

    const cp     = currentPeriod;
    const liquid = n(cp.bit_maor) + n(cp.bit_ido) + n(cp.bit_ravit) + n(cp.bit_dorin) + n(cp.paybox_maor) + n(cp.paybox_ido) + n(cp.cashcash_ido) + n(cp.cashcash_maor);
    const total       = liquid + n(cp.debt_ido) + n(cp.debt_maor) + otherPlayersDebtTotal();
    const chipsIls    = chipsToIls(n(cp.counter) + n(cp.badbeat));
    const profitTotal = total - chipsIls;
    const profitHalf  = profitTotal / 2;

    // 2. Save full snapshot to history
    await dbPost('history', {
      period_start:          periodStart || null,
      period_end:            today(),
      total_expenses_chips:  totalExpenses,
      total_withdrawals_ils: totalWd,
      total_general_expenses_ils: totalGeneralExpenses,
      profit_total:          profitTotal,
      profit_ido:            profitHalf,
      profit_maor:           profitHalf,
      entry_type:            'regular',
      closed_by:             getDisplayName(),
      notes:                 null,
      counter_snapshot:      n(cp.counter),
      detail_rakeback:       detailRakeback,
      detail_tournaments:    detailTournaments,
      detail_bonuses:        detailBonuses,
      detail_referrals:      detailReferrals,
      detail_withdrawals:    detailWithdrawals,
      detail_expenses:       detailExpenses,
      chips_per_shekel:      CHIPS_PER_SHEKEL,
      rake_app:              n(cp.rake_app),
      badbeat_snapshot:      n(cp.badbeat)
    });

    // 3. Reset current_period — debts are intentionally kept
    const resetData = {
      bit_maor: 0, bit_ido: 0, bit_ravit: 0, bit_dorin: 0,
      paybox_maor: 0, paybox_ido: 0, cashcash_ido: 0, cashcash_maor: 0,
      counter: 0, rake_app: 0, badbeat: 0, updated_at: now()
    };
    await dbPatch('current_period', '?id=eq.1', resetData);
    Object.assign(currentPeriod, resetData);

    // 4. Delete all blue table records for this period
    await Promise.all([
      dbDelete('blue_table_rakeback',   '?id=not.is.null'),
      dbDelete('blue_table_tournaments','?id=not.is.null'),
      dbDelete('blue_table_bonuses',    '?id=not.is.null'),
      dbDelete('blue_table_referrals',  '?id=not.is.null'),
      dbDelete('withdrawals',           '?id=not.is.null'),
      dbDelete('blue_table_expenses',   '?id=not.is.null')
    ]);

    showNotif('✅ התקופה נסגרה ונשמרה בהיסטוריה!');
    await loadDashboard();

    // 5. Send WhatsApp summary to the other partner
    try {
      const phones    = { ido: '972559877777', maor: '972546819166' };
      const recipient = getCurrentUser() === 'ido' ? phones.maor : phones.ido;
      const waMsg     = encodeURIComponent(
        `סיכום תקופה 🎰 הסניף הדיגיטלי\n` +
        `━━━━━━━━━━━━━━\n` +
        `📅 תאריך: ${today()}\n` +
        `💰 רווח כולל: ₪${fmt(profitTotal)}\n` +
        `👤 רווח לאחד: ₪${fmt(profitHalf)}\n` +
        `💸 סה"כ משיכות: ₪${fmt(totalWd)}\n` +
        `📊 סה"כ הוצאות: ${fmt(totalExpenses)} צ' (₪${fmt(chipsToIls(totalExpenses))})\n` +
        `🧾 הוצאות כלליות: ₪${fmt(totalGeneralExpenses)}\n` +
        (n(cp.rake_app) > 0 ? (() => {
          const rakeWa = n(cp.rake_app);
          const gapWa  = profitTotal - rakeWa;
          const pctWa  = (Math.abs(gapWa) / rakeWa * 100).toFixed(1);
          return `🎯 Total Rake (App): ₪${fmt(rakeWa)} | פער: ${gapWa >= 0 ? '+' : ''}₪${fmt(gapWa)} (${pctWa}%)\n`;
        })() : '') +
        `━━━━━━━━━━━━━━\n` +
        `נסגר ע"י: ${getDisplayName()}`
      );
      window.open(`https://wa.me/${recipient}?text=${waMsg}`, '_blank');
    } catch {}

  } catch (e) {
    showNotif('שגיאה בסגירת תקופה: ' + e.message, 'error');
  }
}

// ============================================================
// MOBILE — logout from bottom bar
// ============================================================
function toggleSidebar() {} // kept for safety, no longer used
function closeSidebar()  {} // kept for safety, no longer used

// ============================================================
// PAYBOX SUBTITLES — localStorage (editable labels per paybox)
// ============================================================
const PAYBOX_SUBTITLE_DEFAULTS = { maor: 'הסניף הדיגיטלי', ido: 'הסניף הדיגיטלי 2' };

function getPayboxSubtitle(who) {
  return localStorage.getItem('payboxSubtitle_' + who) || PAYBOX_SUBTITLE_DEFAULTS[who];
}

function savePayboxSubtitle(who, text) {
  const val = text.trim();
  if (val) localStorage.setItem('payboxSubtitle_' + who, val);
  else localStorage.removeItem('payboxSubtitle_' + who);
}

function initPayboxSubtitles() {
  ['maor', 'ido'].forEach(who => {
    const el = document.getElementById('paybox-' + who + '-subtitle');
    if (!el) return;
    el.textContent = getPayboxSubtitle(who);
    el.addEventListener('blur', () => savePayboxSubtitle(who, el.textContent));
    el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
  });
}

// ============================================================
// PAGE 7 — SETTLEMENT (התקזזות)
// ============================================================
let settlementUsePaybox = true;

function loadSettlementPage() {
  const cp = currentPeriod || {};

  // Populate team tiles
  const bitIdo     = n(cp.bit_ido);
  const bitDorin   = n(cp.bit_dorin);
  const bitMaor    = n(cp.bit_maor);
  const bitRavit   = n(cp.bit_ravit);
  const payboxMaor = n(cp.paybox_maor);
  const payboxIdo  = n(cp.paybox_ido);

  setText('st-bit-ido',   '₪' + fmt(bitIdo));
  setText('st-bit-dorin', '₪' + fmt(bitDorin));
  setText('st-bit-maor',  '₪' + fmt(bitMaor));
  setText('st-bit-ravit', '₪' + fmt(bitRavit));

  // PayBox rows — fixed per team, visibility controlled by settlementUsePaybox toggle
  const rowIdo  = document.getElementById('st-paybox-ido-row');
  const rowMaor = document.getElementById('st-paybox-maor-row');
  if (rowIdo)  rowIdo.style.display  = settlementUsePaybox ? 'flex' : 'none';
  if (rowMaor) rowMaor.style.display = settlementUsePaybox ? 'flex' : 'none';
  setText('st-paybox-ido-val',  '₪' + fmt(payboxIdo));
  setText('st-paybox-maor-val', '₪' + fmt(payboxMaor));

  setText('st-cashcash-ido',  '₪' + fmt(n(cp.cashcash_ido)));
  setText('st-cashcash-maor', '₪' + fmt(n(cp.cashcash_maor)));

  // Profit per partner — total in coffers minus chips value (counter + badbeat)
  const liquid     = bitIdo + bitDorin + bitMaor + bitRavit + payboxMaor + payboxIdo + n(cp.cashcash_ido) + n(cp.cashcash_maor);
  const total      = liquid + n(cp.debt_ido) + n(cp.debt_maor) + otherPlayersDebtTotal();
  const chipsIls   = chipsToIls(n(cp.counter) + n(cp.badbeat));
  const profitEach = (total - chipsIls) / 2;

  setText('st-profit-each', '₪' + fmt(profitEach));

  // Team totals — Bit + PayBox + CashCash per team
  const pbIdoExtra  = settlementUsePaybox ? payboxIdo  : 0;
  const pbMaorExtra = settlementUsePaybox ? payboxMaor : 0;
  const teamIdo  = bitIdo  + bitDorin + pbIdoExtra  + n(cp.cashcash_ido);
  const teamMaor = bitMaor + bitRavit + pbMaorExtra + n(cp.cashcash_maor);

  setText('st-total-ido',  '₪' + fmt(teamIdo));
  setText('st-total-maor', '₪' + fmt(teamMaor));

  // Transfer = how much Maor is short (positive) or over (negative).
  // After transfer: Maor holds teamMaor + transfer = profitEach ✓
  const transfer = profitEach - teamMaor;
  renderSettlementResult(transfer, profitEach);
}

function renderSettlementResult(transfer, profitEach) {
  const label  = document.getElementById('st-result-label');
  const amount = document.getElementById('st-result-amount');
  const sub    = document.getElementById('st-result-sub');
  if (!label || !amount || !sub) return;

  const abs = Math.abs(transfer);

  let subHtml = '';
  if (abs < 0.5) {
    label.textContent  = 'אין צורך בהעברות';
    amount.textContent = '✓';
    amount.style.color = 'var(--positive)';
    subHtml            = 'כל שותף ימשוך את יתרתו ישירות';
  } else if (transfer > 0) {
    label.textContent  = 'עידו מעביר למאור';
    amount.textContent = '₪' + fmt(abs);
    amount.style.color = 'var(--warning)';
    subHtml            = `עידו מעביר למאור <strong>₪${fmt(abs)}</strong> דרך ביט<br>` +
                         `עידו ימשוך לעצמו <strong>₪${fmt(profitEach)}</strong> מהביט שלו`;
  } else {
    label.textContent  = 'מאור מעביר לעידו';
    amount.textContent = '₪' + fmt(abs);
    amount.style.color = 'var(--accent)';
    subHtml            = `מאור מעביר לעידו <strong>₪${fmt(abs)}</strong> דרך ביט<br>` +
                         `מאור ימשוך לעצמו <strong>₪${fmt(profitEach)}</strong> מהביט שלו`;
  }

  sub.innerHTML = subHtml;
}

function setPayboxUsage(useIt) {
  settlementUsePaybox = useIt;
  document.getElementById('paybox-use-yes').classList.toggle('active',  useIt);
  document.getElementById('paybox-use-no').classList.toggle('active',  !useIt);
  loadSettlementPage();
}

// ============================================================
// UTILITIES
// ============================================================
function n(v)   { return parseFloat(v) || 0; }

const ISRAEL_TZ = 'Asia/Jerusalem';

function israelOffsetString(date = new Date()) {
  const tz = new Intl.DateTimeFormat('en-US', {
    timeZone: ISRAEL_TZ,
    timeZoneName: 'longOffset'
  }).formatToParts(date).find(p => p.type === 'timeZoneName')?.value || 'GMT+2';
  if (tz === 'GMT') return '+00:00';
  const m = tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return '+02:00';
  return `${m[1]}${String(m[2]).padStart(2, '0')}:${String(m[3] || '0').padStart(2, '0')}`;
}

function israelLocalISO(date = new Date()) {
  return date.toLocaleString('sv-SE', { timeZone: ISRAEL_TZ }).replace(' ', 'T') + israelOffsetString(date);
}

function israelDateStr(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: ISRAEL_TZ });
}

function israelDateFromTimestamp(str) {
  if (!str) return '';
  return israelDateStr(new Date(str));
}

function now()  { return israelLocalISO(); }
function today(){ return israelDateStr(); }
function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return israelDateStr(d);
}

function fmt(num) {
  const v = parseFloat(num) || 0;
  return v.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtDate(str) {
  if (!str) return '—';
  try {
    return new Date(str).toLocaleDateString('he-IL', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      timeZone: ISRAEL_TZ
    });
  } catch { return str; }
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function playerLabel(name, nickname) {
  if (!name && !nickname) return '—';
  const primary   = escHtml(nickname || name);
  const secondary = nickname ? `<span class="player-label-sub">${escHtml(name)}</span>` : '';
  return `<span class="player-label-main">${primary}</span>${secondary}`;
}

// ============================================================
// PIN LOCK (pattern-based)
// ============================================================
function showPinLock() {
  patternEntry = [];
  pinLocked = true;
  clearPatternVisual();
  clearPinError();
  document.getElementById('pin-overlay').style.display = 'flex';
}

function hidePinLock() {
  pinLocked = false;
  document.getElementById('pin-overlay').style.display = 'none';
  resetInactivityTimer();
  // After successful auth, handle any pending tab switch
  if (window._pendingTabSwitch === 'management') {
    window._pendingTabSwitch = null;
    if (!window._mgmtMounted) {
      window._mgmtMounted = true;
      mountApp();
    } else {
      showManagementSection();
    }
  }
}

function patternNodeCenters() {
  const wrapRect = document.getElementById('pattern-wrap').getBoundingClientRect();
  const nodes = document.querySelectorAll('.pattern-node');
  return Array.from(nodes).map(el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - wrapRect.left, y: r.top + r.height / 2 - wrapRect.top };
  });
}

function markNodeActive(idx) {
  const node = document.querySelector(`.pattern-node[data-idx="${idx}"]`);
  if (node) node.classList.add('active');
}

function clearPatternVisual() {
  document.querySelectorAll('.pattern-node').forEach(n => n.classList.remove('active', 'error'));
  const svg = document.getElementById('pattern-svg');
  if (svg) { svg.innerHTML = ''; svg.classList.remove('error'); }
}

function drawPatternLines(centers, livePoint) {
  const svg = document.getElementById('pattern-svg');
  if (!svg) return;
  let html = '';
  for (let i = 1; i < patternEntry.length; i++) {
    const a = centers[patternEntry[i - 1]], b = centers[patternEntry[i]];
    html += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
  }
  if (patternDragging && patternEntry.length && livePoint) {
    const a = centers[patternEntry[patternEntry.length - 1]];
    html += `<line x1="${a.x}" y1="${a.y}" x2="${livePoint.x}" y2="${livePoint.y}"/>`;
  }
  svg.innerHTML = html;
}

function checkPattern() {
  if (patternEntry.length >= MIN_PATTERN_LENGTH) {
    const match = Object.keys(PATTERNS).find(user =>
      PATTERNS[user].length === patternEntry.length &&
      PATTERNS[user].every((v, i) => v === patternEntry[i])
    );
    if (match) {
      sessionStorage.setItem('currentUser', match);
      document.getElementById('user-badge').textContent = USER_DISPLAY[match] || match;
      hidePinLock();
      return;
    }
  }
  // Wrong pattern — flash red, clear
  document.querySelectorAll('.pattern-node.active').forEach(n => n.classList.add('error'));
  document.getElementById('pattern-svg')?.classList.add('error');
  document.getElementById('pin-error').textContent = 'תבנית שגויה, נסה שוב';
  setTimeout(() => {
    patternEntry = [];
    clearPatternVisual();
  }, 700);
}

function initPatternLock() {
  const wrap = document.getElementById('pattern-wrap');
  if (!wrap || wrap.dataset.acInit) return;
  wrap.dataset.acInit = '1';

  let centers = [];
  let wrapRect = null;

  function pointFromEvent(e) {
    return { x: e.clientX - wrapRect.left, y: e.clientY - wrapRect.top };
  }

  function nearestNode(pt) {
    let best = -1, bestDist = 26;
    centers.forEach((c, i) => {
      const d = Math.hypot(c.x - pt.x, c.y - pt.y);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }

  function handleMove(e) {
    if (!patternDragging) return;
    const pt = pointFromEvent(e);
    const idx = nearestNode(pt);
    if (idx >= 0 && !patternEntry.includes(idx)) {
      patternEntry.push(idx);
      markNodeActive(idx);
    }
    drawPatternLines(centers, pt);
  }

  wrap.addEventListener('pointerdown', e => {
    wrap.setPointerCapture(e.pointerId);
    wrapRect = wrap.getBoundingClientRect();
    centers = patternNodeCenters();
    patternDragging = true;
    patternEntry = [];
    clearPatternVisual();
    handleMove(e);
  });
  wrap.addEventListener('pointermove', handleMove);
  wrap.addEventListener('pointerup', () => {
    if (!patternDragging) return;
    patternDragging = false;
    checkPattern();
  });
  wrap.addEventListener('pointercancel', () => { patternDragging = false; });
}

function clearPinError() {
  const el = document.getElementById('pin-error');
  if (el) el.textContent = '';
}

function resetInactivityTimer() {
  clearTimeout(pinInactiveTimer);
  if (getCurrentUser()) {
    pinInactiveTimer = setTimeout(showPinLock, PIN_TIMEOUT_MS);
  }
}

function initPinLock() {
  initPatternLock();

  // Reset timer on any user interaction
  ['click','touchstart','keydown','scroll'].forEach(evt =>
    document.addEventListener(evt, resetInactivityTimer, { passive: true })
  );

  // Lock when tab/app goes to background then returns after timeout
  let hiddenAt = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
    } else {
      if (hiddenAt && (Date.now() - hiddenAt) >= PIN_TIMEOUT_MS && getCurrentUser()) {
        showPinLock();
      }
      hiddenAt = null;
    }
  });

  resetInactivityTimer();
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  // Contacts tab is the default landing page — no auto-mount or PIN on load.
  // Management is accessed via the tab switcher which handles auth.
  initPinLock(); // register inactivity + visibility listeners

  // Wire the app-grid back button
  const backBtn = document.getElementById('back-btn');
  if (backBtn) backBtn.addEventListener('click', goBack);
});
// ------------------------------------------------------------
// EXPORT HISTORY → EXCEL (.xlsx)
// ------------------------------------------------------------
function exportHistoryToExcel() {
  if (typeof XLSX === 'undefined') {
    showNotif('ספריית האקסל לא נטענה — נסה לרענן את הדף', 'error');
    return;
  }
  if (!historyData || !historyData.length) {
    showNotif('אין נתוני היסטוריה לייצוא', 'error');
    return;
  }

  const catLabel = { subscription: 'מנוי אפליקציה', event: 'אירוע', other: 'אחר' };

  // מיון עולה לפי תאריך סגירה
  const rows = [...historyData].sort((a, b) => new Date(a.period_end) - new Date(b.period_end));

  // --- גיליון 1: סיכום תקופות (כולל שדות שלא מוצגים בטבלה) ---
  const summary = rows.map(r => ({
    'תאריך פתיחה': r.period_start || '',
    'תאריך סגירה': r.period_end || '',
    'סוג רשומה': r.entry_type === 'manual_import' ? 'ייבוא ידני' : 'רגיל',
    "הוצאות טבלה (צ'יפים)": n(r.total_expenses_chips),
    'הוצאות טבלה (₪)': chipsToIls(r.total_expenses_chips, historyRatio(r)),
    'הוצאות כלליות (₪)': n(r.total_general_expenses_ils),
    'משיכות (₪)': n(r.total_withdrawals_ils),
    'רווח כללי (₪)': n(r.profit_total),
    'רווח לאחד (₪)': n(r.profit_total) / 2,
    'רווח עידו (₪)': n(r.profit_ido),
    'רווח מאור (₪)': n(r.profit_maor),
    "ספירת צ'יפים": n(r.counter_snapshot),
    'נסגר ע"י': r.closed_by || '',
    'הערות': r.notes || ''
  }));

  const wb = XLSX.utils.book_new();
  const wsSummary = XLSX.utils.json_to_sheet(summary);
  styleSheet(wsSummary, summary);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'סיכום תקופות');

  // --- גיליונות פירוט: שיטוח הנתונים מכל התקופות (מתויג לפי תקופה) ---
  const rakeback = [], tournaments = [], bonuses = [], referrals = [], withdrawals = [], expenses = [];

  rows.forEach(r => {
    const pe = r.period_end || '';
    (r.detail_rakeback || []).forEach(d => rakeback.push({
      'תקופה': pe, 'שחקן': d.player, "גנייה (צ'יפים)": n(d.rakeback_chips),
      'החזר (₪)': n(d.rakeback_ils), 'תאריך': d.date || ''
    }));
    (r.detail_tournaments || []).forEach(d => tournaments.push({
      'תקופה': pe, 'שחקן': d.player, "פרס (צ'יפים)": n(d.prize_chips),
      'פרס (₪)': n(d.prize_ils), 'תאריך': d.date || ''
    }));
    (r.detail_bonuses || []).forEach(d => bonuses.push({
      'תקופה': pe, 'שחקן': d.player, "צ'יפים": n(d.chips),
      '₪': n(d.ils), 'הערה': d.note || '', 'תאריך': d.date || ''
    }));
    (r.detail_referrals || []).forEach(d => referrals.push({
      'תקופה': pe, 'מביא': d.referring, 'מובא': d.referred,
      "צ'יפים": n(d.chips), 'תאריך': d.date || ''
    }));
    (r.detail_withdrawals || []).forEach(d => withdrawals.push({
      'תקופה': pe, 'שחקן': d.player, 'סכום (₪)': n(d.amount_ils),
      'אמצעי': d.method || '', 'תאריך': d.date || ''
    }));
    (r.detail_expenses || []).forEach(d => expenses.push({
      'תקופה': pe, 'תיאור': d.description || '',
      'מהות': catLabel[d.category] || d.category || '',
      'פירוט אחר': d.other_description || '',
      'סכום (₪)': n(d.amount_ils), 'תאריך': d.date || ''
    }));
  });

  const addSheet = (data, name) => {
    if (!data.length) return; // דילוג על גיליונות ריקים
    const ws = XLSX.utils.json_to_sheet(data);
    styleSheet(ws, data);
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  addSheet(rakeback, 'החזרי גנייה');
  addSheet(tournaments, 'טורנירים');
  addSheet(bonuses, 'בונוסים');
  addSheet(referrals, 'חבר מביא חבר');
  addSheet(withdrawals, 'משיכות');
  addSheet(expenses, 'הוצאות');

  try {
    XLSX.writeFile(wb, `היסטוריה_הסניף_הדיגיטלי_${today()}.xlsx`);
    showNotif('✅ קובץ האקסל הורד');
  } catch (e) {
    showNotif('שגיאה בייצוא: ' + e.message, 'error');
  }
}

// RTL + רוחב עמודות אוטומטי לגיליון מיוצא
function styleSheet(ws, data) {
  ws['!views'] = [{ RTL: true }];
  if (data && data.length) {
    const keys = Object.keys(data[0]);
    ws['!cols'] = keys.map(k => {
      let max = k.length;
      data.forEach(row => {
        const v = row[k] == null ? '' : String(row[k]);
        if (v.length > max) max = v.length;
      });
      return { wch: Math.min(Math.max(max + 2, 8), 40) };
    });
  }
}