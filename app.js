/* ============================================================
   הסניף הדיגיטלי — Application Logic
   ============================================================ */

// ============================================================
// CONFIGURATION — עדכן כאן לפני פריסה
// ============================================================
const SUPABASE_URL      = 'https://nmwoepvgecnwrxzkyzeu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_9TvfEI2S3K_M95-LBzikvg_r63QVQXc';

const USER_DISPLAY = { ido: 'עידו', maor: 'מאור' };

// Each PIN maps to a user — PIN is the only authentication method
const PINS = {
  '21121986': 'ido',
  '19121987': 'maor'
};
const MAX_PIN_LENGTH = 8;
const PIN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// ============================================================
// STATE
// ============================================================
let currentPeriod   = null;
let players         = [];
let profitChart     = null;
let historyData     = [];
let chartMode       = 'person'; // 'person' | 'total'
let chartMonths     = null;     // null = all, or number of months
let pinEntry        = '';
let pinLocked       = false;
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
  currentPeriod = null;
  players       = [];
  showPinLock();
}

// ============================================================
// APP MOUNT
// ============================================================
async function mountApp() {
  document.getElementById('app').style.display      = 'flex';
  document.getElementById('user-badge').textContent = getDisplayName();

  try {
    await loadInitialData();
  } catch (e) {
    showNotif('שגיאה בטעינת הנתונים: ' + e.message, 'error');
  }

  initPayboxOwnerUI();
  navigate('dashboard');
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
      paybox: 0, cashcash: 0, bank_leumi: 0, debt_ido: 0, debt_maor: 0, counter: 0
    });
    currentPeriod = (created && created[0]) ? created[0] : {
      id: 1, bit_maor: 0, bit_ido: 0, bit_ravit: 0, bit_dorin: 0,
      paybox: 0, cashcash: 0, bank_leumi: 0, debt_ido: 0, debt_maor: 0, counter: 0
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
// NAVIGATION
// ============================================================
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('[data-page]').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');

  // Highlight both topbar and bottom-tabs items
  document.querySelectorAll(`[data-page="${page}"]`).forEach(el => el.classList.add('active'));

  // Scroll to top on page change (important on mobile)
  window.scrollTo({ top: 0, behavior: 'smooth' });

  loadPageData(page);
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

  const liquid   = n(cp.bit_maor) + n(cp.bit_ido) + n(cp.bit_ravit) + n(cp.bit_dorin) + n(cp.paybox) + n(cp.cashcash) + n(cp.bank_leumi);
  const total    = liquid + n(cp.debt_ido) + n(cp.debt_maor);
  const chipsIls = n(cp.counter) / 10;
  const profit   = chipsIls - liquid;   // רווח כללי ללא ניכוי חובות
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

  setVal('bit_maor',      cp.bit_maor  || '');
  setVal('bit_ido',       cp.bit_ido   || '');
  setVal('bit_ravit',     cp.bit_ravit || '');
  setVal('bit_dorin',     cp.bit_dorin || '');
  setVal('paybox',        cp.paybox    || '');
  setVal('cashcash',      cp.cashcash  || '');
  setVal('bank_leumi',    cp.bank_leumi || '');
  setVal('funds-debt_ido',  cp.debt_ido  || '');
  setVal('funds-debt_maor', cp.debt_maor || '');

  updateFundsSummary();
}

function updateFundsSummary() {
  const g = id => parseFloat(document.getElementById(id)?.value) || 0;
  const liquid = g('bit_maor') + g('bit_ido') + g('bit_ravit') + g('bit_dorin') + g('paybox') + g('cashcash') + g('bank_leumi');
  const total  = liquid + g('funds-debt_ido') + g('funds-debt_maor');

  setText('funds-liquid', '₪' + fmt(liquid));
  setText('funds-total',  '₪' + fmt(total));
}

async function saveFunds() {
  try {
    const g = id => parseFloat(document.getElementById(id)?.value) || 0;
    const data = {
      bit_maor: g('bit_maor'),  bit_ido: g('bit_ido'),
      bit_ravit: g('bit_ravit'), bit_dorin: g('bit_dorin'),
      paybox: g('paybox'),       cashcash: g('cashcash'),
      bank_leumi: g('bank_leumi'),
      updated_at: now()
    };

    await dbPatch('current_period', '?id=eq.1', data);
    Object.assign(currentPeriod, data);
    showNotif('✅ כספים בחוץ נשמרו');
  } catch (e) {
    showNotif('שגיאה בשמירה: ' + e.message, 'error');
  }
}

// ============================================================
// PAGE 3 — BLUE TABLE
// ============================================================
function switchBlueTab(tab, el) {
  document.querySelectorAll('#blue-tabs .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('bt-' + tab).classList.add('active');
}

async function loadBlueTable() {
  // Refresh players list in case it changed
  try { players = (await dbGet('players', '?order=name.asc')) || []; } catch {}

  initAllPlayerACs();

  // Set today's date on withdrawal form if empty
  const wdDate = document.getElementById('wd-date');
  if (wdDate && !wdDate.value) wdDate.value = today();

  // Load counter
  if (currentPeriod) {
    setVal('counter-value', currentPeriod.counter || '');
    updateCounterDisplay();
  }

  await Promise.all([
    loadRakebackTable(),
    loadTournamentsTable(),
    loadBonusesTable(),
    loadReferralsTable(),
    loadWithdrawalsTable()
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

function initAllPlayerACs() {
  // rb-player: only players with rakeback_percent > 0
  initPlayerAC('rb-player-wrap', 'rb-player',
    p => (p.rakeback_percent || 0) > 0,
    () => updateRakebackCalc()
  );
  initPlayerAC('tn-player-wrap', 'tn-player', null);
  initPlayerAC('bn-player-wrap', 'bn-player', null);
  initPlayerAC('ref-from-wrap',  'ref-from',  null);
  initPlayerAC('ref-to-wrap',    'ref-to',    null);
  initPlayerAC('wd-player-wrap', 'wd-player', null);
}

// — Counter —
function updateCounterDisplay() {
  const val = parseFloat(document.getElementById('counter-value')?.value) || 0;
  setText('counter-ils', '₪' + fmt(val / 10));
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
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">אין רשומות בתקופה הנוכחית</td></tr>';
      setText('bt-rb-summary', '');
      return;
    }
    tbody.innerHTML = data.map(r => `
      <tr>
        <td>${fmtDate(r.created_at)}</td>
        <td>${playerLabel(r.players?.name, r.players?.nickname)}</td>
        <td class="chips-color">${fmt(r.rake_taken)}</td>
        <td>${fmt(r.rakeback_percent)}%</td>
        <td class="chips-color"><strong>${fmt(r.rakeback_amount)}</strong></td>
        <td>${r.created_by || '—'}</td>
        <td><button class="btn btn-danger btn-xs" onclick="deleteRecord('blue_table_rakeback','${r.id}','loadRakebackTable')">מחק</button></td>
      </tr>`).join('');
    const total = data.reduce((s, r) => s + n(r.rakeback_amount), 0);
    setText('bt-rb-summary', `סה"כ: ${fmt(total)} צ' | ₪${fmt(total / 10)}`);
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
      created_by: getDisplayName()
    });
    document.getElementById('rb-rake').value = '';
    setText('rb-calc', '0 צ\'יפים');
    clearPlayerAC('rb-player');
    showNotif('✅ רשומת החזר גנייה נוספה');
    await loadRakebackTable();
    refreshBTSummary();
  } catch (e) {
    showNotif('שגיאה: ' + e.message, 'error');
  }
}

// — Tournaments —
async function loadTournamentsTable() {
  try {
    const data = await dbGet('blue_table_tournaments', '?order=created_at.desc&select=*,players(name,nickname)');
    const tbody = document.getElementById('tn-table-body');
    if (!data || !data.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">אין רשומות בתקופה הנוכחית</td></tr>';
      setText('bt-tn-summary', '');
      return;
    }
    tbody.innerHTML = data.map(r => `
      <tr>
        <td>${fmtDate(r.created_at)}</td>
        <td>${playerLabel(r.players?.name, r.players?.nickname)}</td>
        <td>${r.tournament_type === 'omaha' ? 'אומהה' : 'הולדם'}</td>
        <td class="chips-color"><strong>${fmt(r.prize_chips)}</strong></td>
        <td>${r.created_by || '—'}</td>
        <td><button class="btn btn-danger btn-xs" onclick="deleteRecord('blue_table_tournaments','${r.id}','loadTournamentsTable')">מחק</button></td>
      </tr>`).join('');
    const total = data.reduce((s, r) => s + n(r.prize_chips), 0);
    setText('bt-tn-summary', `סה"כ: ${fmt(total)} צ' | ₪${fmt(total / 10)}`);
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
      prize_chips: prize, created_by: getDisplayName()
    });
    document.getElementById('tn-prize').value = '';
    clearPlayerAC('tn-player');
    showNotif('✅ רשומת טורניר נוספה');
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
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">אין רשומות בתקופה הנוכחית</td></tr>';
      setText('bt-bn-summary', '');
      return;
    }
    tbody.innerHTML = data.map(r => `
      <tr>
        <td>${fmtDate(r.created_at)}</td>
        <td>${playerLabel(r.players?.name, r.players?.nickname)}</td>
        <td class="chips-color"><strong>${fmt(r.chips_amount)}</strong></td>
        <td>${r.created_by || '—'}</td>
        <td><button class="btn btn-danger btn-xs" onclick="deleteRecord('blue_table_bonuses','${r.id}','loadBonusesTable')">מחק</button></td>
      </tr>`).join('');
    const total = data.reduce((s, r) => s + n(r.chips_amount), 0);
    setText('bt-bn-summary', `סה"כ: ${fmt(total)} צ' | ₪${fmt(total / 10)}`);
  } catch (e) {
    showNotif('שגיאה בטעינת בונוסים: ' + e.message, 'error');
  }
}

async function addBonus() {
  const playerId = document.getElementById('bn-player').value;
  const chips    = parseFloat(document.getElementById('bn-chips').value);
  if (!playerId) { showNotif('אנא בחר שחקן', 'error'); return; }
  if (!chips || chips <= 0) { showNotif('אנא הזן כמות תקינה', 'error'); return; }

  try {
    await dbPost('blue_table_bonuses', {
      player_id: playerId, chips_amount: chips, created_by: getDisplayName()
    });
    document.getElementById('bn-chips').value = '';
    clearPlayerAC('bn-player');
    showNotif('✅ בונוס נוסף');
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
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">אין רשומות בתקופה הנוכחית</td></tr>';
      setText('bt-ref-summary', '');
      return;
    }
    tbody.innerHTML = data.map(r => {
      const from = players.find(p => p.id === r.referring_player_id);
      const to   = players.find(p => p.id === r.referred_player_id);
      return `
        <tr>
          <td>${fmtDate(r.created_at)}</td>
          <td>${playerLabel(from?.name, from?.nickname)}</td>
          <td>${playerLabel(to?.name, to?.nickname)}</td>
          <td class="chips-color"><strong>${fmt(r.chips_amount)}</strong></td>
          <td>${r.created_by || '—'}</td>
          <td><button class="btn btn-danger btn-xs" onclick="deleteRecord('blue_table_referrals','${r.id}','loadReferralsTable')">מחק</button></td>
        </tr>`;
    }).join('');
    const total = data.reduce((s, r) => s + n(r.chips_amount), 0);
    setText('bt-ref-summary', `סה"כ: ${fmt(total)} צ' | ₪${fmt(total / 10)}`);
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
      chips_amount: chips, created_by: getDisplayName()
    });
    document.getElementById('ref-chips').value = '';
    clearPlayerAC('ref-from');
    clearPlayerAC('ref-to');
    showNotif('✅ רשומת חבר מביא חבר נוספה');
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
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">אין רשומות בתקופה הנוכחית</td></tr>';
      setText('bt-wd-summary', '');
      return;
    }
    tbody.innerHTML = data.map(r => `
      <tr>
        <td>${r.withdrawal_date || fmtDate(r.created_at)}</td>
        <td>${playerLabel(r.players?.name, r.players?.nickname)}</td>
        <td class="positive-color"><strong>₪${fmt(r.amount_ils)}</strong></td>
        <td class="chips-color">${fmt(r.chips_amount)}</td>
        <td>${r.created_by || '—'}</td>
        <td><button class="btn btn-danger btn-xs" onclick="deleteRecord('withdrawals','${r.id}','loadWithdrawalsTable')">מחק</button></td>
      </tr>`).join('');
    const totalIls   = data.reduce((s, r) => s + n(r.amount_ils), 0);
    const totalChips = data.reduce((s, r) => s + n(r.chips_amount), 0);
    setText('bt-wd-summary', `סה"כ: ₪${fmt(totalIls)} | ${fmt(totalChips)} צ'`);
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

  const ils = chips / 10;

  try {
    await dbPost('withdrawals', {
      player_id: playerId, withdrawal_date: date,
      amount_ils: ils, chips_amount: chips, created_by: getDisplayName()
    });
    document.getElementById('wd-chips').value = '';
    clearPlayerAC('wd-player');
    showNotif('✅ משיכה נוספה');
    await loadWithdrawalsTable();
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
    const [rb, tn, bn, ref, wd] = await Promise.all([
      dbGet('blue_table_rakeback',   '?select=rakeback_amount'),
      dbGet('blue_table_tournaments','?select=prize_chips'),
      dbGet('blue_table_bonuses',    '?select=chips_amount'),
      dbGet('blue_table_referrals',  '?select=chips_amount'),
      dbGet('withdrawals',           '?select=amount_ils,chips_amount')
    ]);

    const sum = (arr, key) => (arr || []).reduce((s, r) => s + n(r[key]), 0);
    const sumRb    = sum(rb,  'rakeback_amount');
    const sumTn    = sum(tn,  'prize_chips');
    const sumBn    = sum(bn,  'chips_amount');
    const sumRef   = sum(ref, 'chips_amount');
    const sumWdIls   = sum(wd, 'amount_ils');
    const sumWdChips = sum(wd, 'chips_amount');
    const totalChips = sumRb + sumTn + sumBn + sumRef;

    // Global summary bar
    setText('bt-total-chips',       fmt(totalChips) + ' צ\'יפים');
    setText('bt-total-ils',         '₪' + fmt(totalChips / 10));
    setText('bt-total-withdrawals', '₪' + fmt(sumWdIls));

    // Per-tab summary rows (only if not already set by load functions)
    const upd = (id, txt) => { const el = document.getElementById(id); if (el && !el.textContent) el.textContent = txt; };
    upd('bt-rb-summary',  `סה"כ: ${fmt(sumRb)} צ' | ₪${fmt(sumRb / 10)}`);
    upd('bt-tn-summary',  `סה"כ: ${fmt(sumTn)} צ' | ₪${fmt(sumTn / 10)}`);
    upd('bt-bn-summary',  `סה"כ: ${fmt(sumBn)} צ' | ₪${fmt(sumBn / 10)}`);
    upd('bt-ref-summary', `סה"כ: ${fmt(sumRef)} צ' | ₪${fmt(sumRef / 10)}`);
    upd('bt-wd-summary',  `סה"כ: ₪${fmt(sumWdIls)} | ${fmt(sumWdChips)} צ'`);

    // Dashboard card
    setText('dash-rb-sum',  `${fmt(sumRb)} צ'`);
    setText('dash-tn-sum',  `${fmt(sumTn)} צ'`);
    setText('dash-bn-sum',  `${fmt(sumBn)} צ'`);
    setText('dash-ref-sum', `${fmt(sumRef)} צ'`);
    setText('dash-wd-sum',  `₪${fmt(sumWdIls)}`);

    // Dashboard expenses card
    setText('val-expenses-ils', fmt(totalChips / 10));
  } catch {}
}

// ============================================================
// PAGE 4 — DEBTS
// ============================================================
async function loadDebts() {
  const cp = currentPeriod || {};
  setText('debt-ido-display',  fmt(n(cp.debt_ido)));
  setText('debt-maor-display', fmt(n(cp.debt_maor)));
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
  try {
    await dbPatch('current_period', '?id=eq.1', { [field]: newVal, updated_at: now() });
    currentPeriod[field] = newVal;
    setText(`debt-${person}-display`, fmt(newVal));

    // Keep funds page readonly fields in sync if they exist
    const fundsEl = document.getElementById(`funds-debt_${person}`);
    if (fundsEl) fundsEl.value = newVal;

    showNotif(`✅ חוב ${person === 'ido' ? 'עידו' : 'מאור'} עודכן → ₪${fmt(newVal)}`);
  } catch (e) {
    showNotif('שגיאה בעדכון חוב: ' + e.message, 'error');
  }
}

// ============================================================
// PAGE 5 — HISTORY & GRAPHS
// ============================================================
async function loadHistory() {
  try {
    const data = await dbGet('history', '?order=period_end.desc');
    historyData = data || [];
    renderHistoryTable(historyData);
    renderProfitChart();
  } catch (e) {
    showNotif('שגיאה בטעינת היסטוריה: ' + e.message, 'error');
  }
}

function renderHistoryTable(data) {
  const tbody = document.getElementById('history-table-body');
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">אין נתוני היסטוריה</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(r => {
    const profitColor    = n(r.profit_total) >= 0 ? 'positive-color' : 'negative-color';
    const perPersonColor = (n(r.profit_total) / 2) >= 0 ? 'positive-color' : 'negative-color';
    const expensesIls    = n(r.total_expenses_chips) / 10;
    return `
    <tr>
      <td>${r.period_end || '—'}</td>
      <td class="col-hide-sm">₪${fmt(expensesIls)}</td>
      <td class="col-hide-sm">₪${fmt(r.total_withdrawals_ils)}</td>
      <td class="${profitColor}"><strong>₪${fmt(r.profit_total)}</strong></td>
      <td class="${perPersonColor}"><strong>₪${fmt(n(r.profit_total) / 2)}</strong></td>
      <td class="col-hide-sm">₪${fmt(r.profit_ido)}</td>
      <td class="col-hide-sm">₪${fmt(r.profit_maor)}</td>
      <td class="col-hide-xs" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.notes || '—'}</td>
      <td>
        <div class="action-row">
          <button class="btn btn-secondary btn-xs" onclick='openPeriodDetail(${JSON.stringify(r).replace(/'/g,"&#39;")})'>פרטים</button>
          <button class="btn btn-danger btn-xs" onclick="deleteHistory('${r.id}')">מחק</button>
        </div>
      </td>
    </tr>`;
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
  ['3','6','12','all'].forEach(k => {
    const el = document.getElementById('chart-filter-' + k);
    if (el) el.classList.toggle('active', k === (months === null ? 'all' : String(months)));
  });
  renderProfitChart();
}

function renderProfitChart() {
  const ctx = document.getElementById('profit-chart');
  if (!ctx) return;

  if (profitChart) { profitChart.destroy(); profitChart = null; }
  if (!historyData.length) return;

  // Sort ascending by date
  let sorted = [...historyData].sort((a, b) => new Date(a.period_end) - new Date(b.period_end));

  // Apply month filter
  if (chartMonths !== null) {
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
        legend: { labels: { color: '#9090b0', font: { family: 'Heebo', size: 12 } } },
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

  // Counter
  const counterHtml = r.counter_snapshot
    ? `<div class="pd-stat">Counter: <strong>${fmt(n(r.counter_snapshot))} צ'</strong> = <strong>₪${fmt(n(r.counter_snapshot)/10)}</strong></div>`
    : '';

  // Summary
  const summaryHtml = `<div class="pd-stat-grid">
    <div class="pd-stat-item"><span>רווח כולל</span><strong class="${n(r.profit_total)>=0?'positive-color':'negative-color'}">₪${fmt(r.profit_total)}</strong></div>
    <div class="pd-stat-item"><span>רווח לאחד</span><strong class="${n(r.profit_total)>=0?'positive-color':'negative-color'}">₪${fmt(n(r.profit_total)/2)}</strong></div>
    <div class="pd-stat-item"><span>הוצאות</span><strong>₪${fmt(n(r.total_expenses_chips)/10)}</strong></div>
    <div class="pd-stat-item"><span>משיכות</span><strong>₪${fmt(r.total_withdrawals_ils)}</strong></div>
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
    ['שחקן','צ\'יפים','₪'],
    (r.detail_bonuses || []).map(x => [x.player, fmt(x.chips), `₪${fmt(x.ils)}`])
  );

  // Referrals
  const refHtml = miniTable(
    ['מפנה','מופנה','צ\'יפים'],
    (r.detail_referrals || []).map(x => [x.referring, x.referred, fmt(x.chips)])
  );

  body.innerHTML =
    summaryHtml +
    (counterHtml ? `<div class="pd-section">${counterHtml}</div>` : '') +
    section('💳','משיכות',         wdHtml)  +
    section('💸','החזר גנייה',     rbHtml)  +
    section('🏆','טורנירים',       tnHtml)  +
    section('🎁','בונוס צ\'יפים',  bnHtml)  +
    section('🤝','חבר מביא חבר',  refHtml);

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
        rows.push({ date, category: '🎁 בונוס', detail: `${fmt(x.chips)} צ' (₪${fmt(x.ils)})` });
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
    const rb    = p.rakeback_percent != null && p.rakeback_percent !== '' ? p.rakeback_percent + '%' : '—';
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
    const rb    = p.rakeback_percent != null && p.rakeback_percent !== '' ? p.rakeback_percent + '%' : '—';
    const wdLbl = WITHDRAWAL_LABELS[p.preferred_withdrawal] || '—';
    return `
    <div class="player-card">
      <div class="player-card-header">
        <div>
          <div class="player-card-name">${escHtml(p.name)}</div>
          ${p.nickname ? `<div class="player-card-nick">"${escHtml(p.nickname)}"</div>` : ''}
        </div>
        <div class="action-row">
          <button class="btn btn-secondary btn-xs" onclick="openEditModal('${p.id}')">✏️</button>
          <button class="btn btn-secondary btn-xs" onclick="openPlayerStats('${p.id}','${escHtml(p.nickname||p.name)}')">📊</button>
          <button class="btn btn-danger btn-xs" onclick="deletePlayer('${p.id}')">🗑️</button>
        </div>
      </div>
      <div class="player-card-info">
        <div class="player-info-item">
          <span class="player-info-label">החזר גנייה</span>
          <span class="player-info-value">${rb}</span>
        </div>
        <div class="player-info-item">
          <span class="player-info-label">משיכה מועדפת</span>
          <span class="player-info-value">${wdLbl}</span>
        </div>
        <div class="player-info-item">
          <span class="player-info-label">הצטרף</span>
          <span class="player-info-value">${fmtDate(p.created_at)}</span>
        </div>
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
  const withdrawal = document.getElementById('ep-withdrawal')?.value || 'bit';

  if (!name) { showNotif('אנא הזן שם שחקן', 'error'); return; }
  if (rb !== null && (isNaN(rb) || rb < 0 || rb > 100)) {
    showNotif('אחוז החזר חייב להיות 0–100', 'error'); return;
  }

  try {
    await dbPatch('players', `?id=eq.${id}`, {
      name, nickname, rakeback_percent: rb, preferred_withdrawal: withdrawal
    });
    const p = players.find(pl => pl.id === id);
    if (p) Object.assign(p, { name, nickname, rakeback_percent: rb, preferred_withdrawal: withdrawal });

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
  const withdrawal = document.getElementById('ap-withdrawal')?.value || 'bit';

  if (!name) { showNotif('אנא הזן שם שחקן', 'error'); return; }
  if (rb !== null && (isNaN(rb) || rb < 0 || rb > 100)) {
    showNotif('אחוז החזר חייב להיות 0–100', 'error'); return;
  }

  try {
    const result = await dbPost('players', {
      name, nickname, rakeback_percent: rb, preferred_withdrawal: withdrawal
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
    '<strong style="color:var(--negative)">פעולה זו בלתי הפיכה!</strong>';
  document.getElementById('confirm-ok').onclick = () => {
    closeConfirm();
    closePeriod();
  };
  document.getElementById('confirm-overlay').style.display = 'flex';
}

function closeConfirm() {
  document.getElementById('confirm-overlay').style.display = 'none';
}

async function closePeriod() {
  showNotif('⏳ מבצע סגירת תקופה...', 'info');
  try {
    // 1. Fetch full detail from all blue tables (with player names)
    const [rb, tn, bn, ref, wd] = await Promise.all([
      dbGet('blue_table_rakeback',   '?select=*,players(name,nickname)&order=created_at.asc'),
      dbGet('blue_table_tournaments','?select=*,players(name,nickname)&order=created_at.asc'),
      dbGet('blue_table_bonuses',    '?select=*,players(name,nickname)&order=created_at.asc'),
      dbGet('blue_table_referrals',  '?select=id,chips_amount,created_at,referring_player_id,referred_player_id'),
      dbGet('withdrawals',           '?select=*,players(name,nickname)&order=created_at.asc')
    ]);

    const sumField    = (arr, key) => (arr || []).reduce((s, r) => s + n(r[key]), 0);
    const playerLabel = p => p?.nickname || p?.name || '—';

    // Build JSONB detail snapshots
    const detailRakeback = (rb || []).map(r => ({
      player: playerLabel(r.players),
      rakeback_chips: n(r.rakeback_amount),
      rakeback_ils:   n(r.rakeback_amount) / 10,
      date: r.created_at?.slice(0,10)
    }));

    const detailTournaments = (tn || []).map(r => ({
      player:      playerLabel(r.players),
      prize_chips: n(r.prize_chips),
      prize_ils:   n(r.prize_chips) / 10,
      date: r.created_at?.slice(0,10)
    }));

    const detailBonuses = (bn || []).map(r => ({
      player:      playerLabel(r.players),
      chips:       n(r.chips_amount),
      ils:         n(r.chips_amount) / 10,
      date: r.created_at?.slice(0,10)
    }));

    const detailReferrals = (ref || []).map(r => {
      const from = players.find(p => p.id === r.referring_player_id);
      const to   = players.find(p => p.id === r.referred_player_id);
      return {
        referring: playerLabel(from),
        referred:  playerLabel(to),
        chips:     n(r.chips_amount),
        date: r.created_at?.slice(0,10)
      };
    });

    const detailWithdrawals = (wd || []).map(r => ({
      player: playerLabel(r.players),
      amount_ils: n(r.amount_ils),
      method: r.method || '',
      date: r.created_at?.slice(0,10)
    }));

    const totalExpenses = sumField(rb,'rakeback_amount') + sumField(tn,'prize_chips') +
                          sumField(bn,'chips_amount')    + sumField(ref,'chips_amount');
    const totalWd = sumField(wd, 'amount_ils');

    const cp     = currentPeriod;
    const liquid = n(cp.bit_maor) + n(cp.bit_ido) + n(cp.bit_ravit) + n(cp.bit_dorin) + n(cp.paybox) + n(cp.cashcash) + n(cp.bank_leumi);
    const chipsIls    = n(cp.counter) / 10;
    const profitTotal = chipsIls - liquid;
    const profitHalf  = profitTotal / 2;

    // 2. Save full snapshot to history
    await dbPost('history', {
      period_end:            today(),
      total_expenses_chips:  totalExpenses,
      total_withdrawals_ils: totalWd,
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
      detail_withdrawals:    detailWithdrawals
    });

    // 3. Reset current_period — debts are intentionally kept
    const resetData = {
      bit_maor: 0, bit_ido: 0, bit_ravit: 0, bit_dorin: 0,
      paybox: 0, cashcash: 0, bank_leumi: 0,
      counter: 0, updated_at: now()
    };
    await dbPatch('current_period', '?id=eq.1', resetData);
    Object.assign(currentPeriod, resetData);

    // 4. Delete all blue table records for this period
    await Promise.all([
      dbDelete('blue_table_rakeback',   '?id=not.is.null'),
      dbDelete('blue_table_tournaments','?id=not.is.null'),
      dbDelete('blue_table_bonuses',    '?id=not.is.null'),
      dbDelete('blue_table_referrals',  '?id=not.is.null'),
      dbDelete('withdrawals',           '?id=not.is.null')
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
        `📊 סה"כ הוצאות: ${fmt(totalExpenses)} צ' (₪${fmt(totalExpenses / 10)})\n` +
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
// PAYBOX OWNER — localStorage
// ============================================================
function getPayboxOwner() {
  return localStorage.getItem('payboxOwner') || 'ido';
}

function setPayboxOwner(who) {
  localStorage.setItem('payboxOwner', who);
  document.getElementById('paybox-owner-ido').classList.toggle('active',  who === 'ido');
  document.getElementById('paybox-owner-maor').classList.toggle('active', who === 'maor');
}

function initPayboxOwnerUI() {
  const owner = getPayboxOwner();
  const idoBtn  = document.getElementById('paybox-owner-ido');
  const maorBtn = document.getElementById('paybox-owner-maor');
  if (idoBtn)  idoBtn.classList.toggle('active',  owner === 'ido');
  if (maorBtn) maorBtn.classList.toggle('active', owner === 'maor');
}

// ============================================================
// PAGE 7 — SETTLEMENT (התקזזות)
// ============================================================
let settlementUsePaybox = true;

function loadSettlementPage() {
  const cp = currentPeriod || {};

  // Populate team tiles
  const bitIdo   = n(cp.bit_ido);
  const bitDorin = n(cp.bit_dorin);
  const bitMaor  = n(cp.bit_maor);
  const bitRavit = n(cp.bit_ravit);
  const paybox   = n(cp.paybox);

  setText('st-bit-ido',   '₪' + fmt(bitIdo));
  setText('st-bit-dorin', '₪' + fmt(bitDorin));
  setText('st-bit-maor',  '₪' + fmt(bitMaor));
  setText('st-bit-ravit', '₪' + fmt(bitRavit));

  // PayBox rows visibility
  const owner = getPayboxOwner();
  const rowIdo  = document.getElementById('st-paybox-ido-row');
  const rowMaor = document.getElementById('st-paybox-maor-row');
  if (rowIdo)  { rowIdo.style.display  = (owner === 'ido'  && settlementUsePaybox) ? 'flex' : 'none'; }
  if (rowMaor) { rowMaor.style.display = (owner === 'maor' && settlementUsePaybox) ? 'flex' : 'none'; }
  setText('st-paybox-ido-val',  '₪' + fmt(paybox));
  setText('st-paybox-maor-val', '₪' + fmt(paybox));

  const bankLeumi = n(cp.bank_leumi);
  setText('st-bank-leumi', '₪' + fmt(bankLeumi));

  // Profit per partner — full liquid includes Leumi
  const liquid     = bitIdo + bitDorin + bitMaor + bitRavit + paybox + n(cp.cashcash) + bankLeumi;
  const chipsIls   = n(cp.counter) / 10;
  const profitEach = (chipsIls - liquid) / 2;

  setText('st-profit-each', '₪' + fmt(profitEach));

  // Team totals — Bit + PayBox only (Leumi excluded)
  const ipoExtra  = (settlementUsePaybox && owner === 'ido')  ? paybox : 0;
  const maorExtra = (settlementUsePaybox && owner === 'maor') ? paybox : 0;
  const teamIdo   = bitIdo + bitDorin + ipoExtra;
  const teamMaor  = bitMaor + bitRavit + maorExtra;

  setText('st-total-ido',  '₪' + fmt(teamIdo));
  setText('st-total-maor', '₪' + fmt(teamMaor));

  // Transfer calculation
  const transfer = profitEach - teamIdo;
  const abs = Math.abs(transfer);
  let leumiNeeded = 0;
  let leumiPayer = null;
  if (abs >= 0.5) {
    if (transfer > 0 && teamMaor < abs) {
      leumiNeeded = abs - teamMaor;
      leumiPayer = 'maor';
    } else if (transfer < 0 && teamIdo < abs) {
      leumiNeeded = abs - teamIdo;
      leumiPayer = 'ido';
    }
  }
  renderSettlementResult(transfer, profitEach, { leumiNeeded, leumiPayer, bankLeumi });
}

function renderSettlementResult(transfer, profitEach, leumi = {}) {
  const label  = document.getElementById('st-result-label');
  const amount = document.getElementById('st-result-amount');
  const sub    = document.getElementById('st-result-sub');
  if (!label || !amount || !sub) return;

  const abs = Math.abs(transfer);
  const { leumiNeeded = 0, leumiPayer = null, bankLeumi = 0 } = leumi;

  let subHtml = '';
  if (Math.abs(transfer) < 0.5) {
    label.textContent  = 'אין צורך בהעברות';
    amount.textContent = '✓';
    amount.style.color = 'var(--positive)';
    subHtml            = 'כל שותף ימשוך את יתרתו ישירות';
  } else if (transfer > 0) {
    label.textContent  = 'מאור מעביר לעידו';
    amount.textContent = '₪' + fmt(abs);
    amount.style.color = 'var(--accent)';
    subHtml            = `מאור מעביר לעידו <strong>₪${fmt(abs)}</strong> דרך ביט<br>` +
                         `מאור ימשוך לעצמו <strong>₪${fmt(profitEach)}</strong> מהביט שלו`;
  } else {
    label.textContent  = 'עידו מעביר למאור';
    amount.textContent = '₪' + fmt(abs);
    amount.style.color = 'var(--warning)';
    subHtml            = `עידו מעביר למאור <strong>₪${fmt(abs)}</strong> דרך ביט<br>` +
                         `עידו ימשוך לעצמו <strong>₪${fmt(profitEach)}</strong> מהביט שלו`;
  }

  if (leumiNeeded > 0) {
    const recipient = leumiPayer === 'maor' ? 'עידו' : 'מאור';
    subHtml += `<br><span style="color:var(--warning)">אין מספיק בביט — יש למשוך <strong>₪${fmt(leumiNeeded)}</strong> מבנק לאומי ולהעביר ל${recipient}</span>`;
    if (bankLeumi < leumiNeeded) {
      subHtml += `<br><span style="color:var(--negative)">⚠️ יתרת בנק לאומי (₪${fmt(bankLeumi)}) עשויה שלא לכסות את הסכום הנדרש</span>`;
    }
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
function now()  { return new Date().toISOString(); }
function today(){ return new Date().toISOString().split('T')[0]; }

function fmt(num) {
  const v = parseFloat(num) || 0;
  return v.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtDate(str) {
  if (!str) return '—';
  try {
    return new Date(str).toLocaleDateString('he-IL',
      { day: '2-digit', month: '2-digit', year: 'numeric' });
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
// PIN LOCK
// ============================================================
function showPinLock() {
  pinEntry  = '';
  pinLocked = true;
  updatePinDots();
  clearPinError();
  document.getElementById('pin-overlay').style.display = 'flex';
}

function hidePinLock() {
  pinLocked = false;
  document.getElementById('pin-overlay').style.display = 'none';
  resetInactivityTimer();
}

function pinPress(digit) {
  if (pinEntry.length >= MAX_PIN_LENGTH) return;
  pinEntry += digit;
  updatePinDots();
  if (pinEntry.length === MAX_PIN_LENGTH) {
    setTimeout(checkPin, 120); // brief delay so last dot animates
  }
}

function pinDel() {
  pinEntry = pinEntry.slice(0, -1);
  updatePinDots();
  clearPinError();
}

function checkPin() {
  const user = PINS[pinEntry];
  if (user) {
    sessionStorage.setItem('currentUser', user);
    document.getElementById('user-badge').textContent = USER_DISPLAY[user] || user;
    hidePinLock();
  } else {
    // Wrong PIN — flash red, clear
    document.querySelectorAll('.pin-dot').forEach(d => {
      d.classList.remove('filled');
      d.classList.add('error');
    });
    document.getElementById('pin-error').textContent = 'קוד שגוי, נסה שוב';
    setTimeout(() => {
      pinEntry = '';
      updatePinDots();
      document.querySelectorAll('.pin-dot').forEach(d => d.classList.remove('error'));
    }, 700);
  }
}

function updatePinDots() {
  for (let i = 0; i < MAX_PIN_LENGTH; i++) {
    const dot = document.getElementById('pd' + i);
    if (dot) {
      dot.classList.toggle('filled', i < pinEntry.length);
      dot.classList.remove('error');
    }
  }
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
  mountApp();    // always mount the app (PIN screen covers it)
  initPinLock(); // register inactivity + visibility listeners
  showPinLock(); // always require PIN on every load
});
