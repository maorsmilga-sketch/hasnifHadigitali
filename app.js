/* ============================================================
   הסניף הדיגיטלי — Application Logic
   ============================================================ */

// ============================================================
// CONFIGURATION — עדכן כאן לפני פריסה
// ============================================================
const SUPABASE_URL      = 'https://nmwoepvgecnwrxzkyzeu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_9TvfEI2S3K_M95-LBzikvg_r63QVQXc';

const USERS = {
  ido:  'ido123',   // סיסמת עידו
  maor: 'maor123'  // סיסמת מאור
};

const USER_DISPLAY = { ido: 'עידו', maor: 'מאור' };

// ============================================================
// STATE
// ============================================================
let currentPeriod = null;
let players       = [];
let profitChart   = null;

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
// AUTH
// ============================================================
function doLogin() {
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');

  if (!username || !password) {
    errEl.style.display = 'block';
    errEl.textContent   = 'אנא בחר משתמש והזן סיסמא';
    return;
  }

  if (USERS[username] && USERS[username] === password) {
    sessionStorage.setItem('currentUser', username);
    errEl.style.display = 'none';
    mountApp();
  } else {
    errEl.style.display = 'block';
    errEl.textContent   = 'שם משתמש או סיסמא שגויים';
    document.getElementById('login-password').value = '';
  }
}

function doLogout() {
  sessionStorage.removeItem('currentUser');
  document.getElementById('app').style.display        = 'none';
  document.getElementById('login-page').style.display = 'flex';
  document.getElementById('login-password').value     = '';
  document.getElementById('login-username').value     = '';
  currentPeriod = null;
  players       = [];
}

function getCurrentUser() {
  return sessionStorage.getItem('currentUser');
}

function getDisplayName() {
  return USER_DISPLAY[getCurrentUser()] || getCurrentUser() || '—';
}

// ============================================================
// APP MOUNT
// ============================================================
async function mountApp() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app').style.display        = 'flex';
  document.getElementById('user-badge').textContent   = getDisplayName();

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
      paybox: 0, cashcash: 0, debt_ido: 0, debt_maor: 0, counter: 0
    });
    currentPeriod = (created && created[0]) ? created[0] : {
      id: 1, bit_maor: 0, bit_ido: 0, bit_ravit: 0, bit_dorin: 0,
      paybox: 0, cashcash: 0, debt_ido: 0, debt_maor: 0, counter: 0
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

  const liquid   = n(cp.bit_maor) + n(cp.bit_ido) + n(cp.bit_ravit) + n(cp.bit_dorin) + n(cp.paybox) + n(cp.cashcash);
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
  setVal('funds-debt_ido',  cp.debt_ido  || '');
  setVal('funds-debt_maor', cp.debt_maor || '');

  updateFundsSummary();
}

function updateFundsSummary() {
  const g = id => parseFloat(document.getElementById(id)?.value) || 0;
  const liquid = g('bit_maor') + g('bit_ido') + g('bit_ravit') + g('bit_dorin') + g('paybox') + g('cashcash');
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

  populatePlayerDropdowns();

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

function populatePlayerDropdowns() {
  const ids = ['rb-player','tn-player','bn-player','ref-from','ref-to','wd-player'];
  ids.forEach(sid => {
    const sel = document.getElementById(sid);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">בחר שחקן...</option>';
    players.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      opt.dataset.rakeback = p.rakeback_percent;
      sel.appendChild(opt);
    });
    if (prev) sel.value = prev;
  });
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
  const sel  = document.getElementById('rb-player');
  const rake = parseFloat(document.getElementById('rb-rake')?.value) || 0;
  const pct  = parseFloat(sel?.options[sel.selectedIndex]?.dataset?.rakeback) || 60;
  setText('rb-calc', fmt(rake * pct / 100) + ' צ\'יפים');
}

async function loadRakebackTable() {
  try {
    const data = await dbGet('blue_table_rakeback', '?order=created_at.desc&select=*,players(name)');
    const tbody = document.getElementById('rb-table-body');
    if (!data || !data.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">אין רשומות בתקופה הנוכחית</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(r => `
      <tr>
        <td>${fmtDate(r.created_at)}</td>
        <td>${r.players?.name || '—'}</td>
        <td class="chips-color">${fmt(r.rake_taken)}</td>
        <td>${fmt(r.rakeback_percent)}%</td>
        <td class="chips-color"><strong>${fmt(r.rakeback_amount)}</strong></td>
        <td>${r.created_by || '—'}</td>
        <td><button class="btn btn-danger btn-xs" onclick="deleteRecord('blue_table_rakeback','${r.id}','loadRakebackTable')">מחק</button></td>
      </tr>`).join('');
  } catch (e) {
    showNotif('שגיאה בטעינת החזרי גנייה: ' + e.message, 'error');
  }
}

async function addRakeback() {
  const sel    = document.getElementById('rb-player');
  const playerId = sel.value;
  const rake   = parseFloat(document.getElementById('rb-rake').value);
  if (!playerId) { showNotif('אנא בחר שחקן', 'error'); return; }
  if (!rake || rake <= 0) { showNotif('אנא הזן כמות גנייה תקינה', 'error'); return; }

  const pct    = parseFloat(sel.options[sel.selectedIndex]?.dataset?.rakeback) || 60;
  const amount = rake * pct / 100;

  try {
    await dbPost('blue_table_rakeback', {
      player_id: playerId, rake_taken: rake,
      rakeback_percent: pct, rakeback_amount: amount,
      created_by: getDisplayName()
    });
    document.getElementById('rb-rake').value = '';
    setText('rb-calc', '0 צ\'יפים');
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
    const data = await dbGet('blue_table_tournaments', '?order=created_at.desc&select=*,players(name)');
    const tbody = document.getElementById('tn-table-body');
    if (!data || !data.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">אין רשומות בתקופה הנוכחית</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(r => `
      <tr>
        <td>${fmtDate(r.created_at)}</td>
        <td>${r.players?.name || '—'}</td>
        <td>${r.tournament_type === 'omaha' ? 'אומהה' : 'הולדם'}</td>
        <td class="chips-color"><strong>${fmt(r.prize_chips)}</strong></td>
        <td>${r.created_by || '—'}</td>
        <td><button class="btn btn-danger btn-xs" onclick="deleteRecord('blue_table_tournaments','${r.id}','loadTournamentsTable')">מחק</button></td>
      </tr>`).join('');
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
    const data = await dbGet('blue_table_bonuses', '?order=created_at.desc&select=*,players(name)');
    const tbody = document.getElementById('bn-table-body');
    if (!data || !data.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">אין רשומות בתקופה הנוכחית</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(r => `
      <tr>
        <td>${fmtDate(r.created_at)}</td>
        <td>${r.players?.name || '—'}</td>
        <td class="chips-color"><strong>${fmt(r.chips_amount)}</strong></td>
        <td>${r.created_by || '—'}</td>
        <td><button class="btn btn-danger btn-xs" onclick="deleteRecord('blue_table_bonuses','${r.id}','loadBonusesTable')">מחק</button></td>
      </tr>`).join('');
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
      return;
    }
    tbody.innerHTML = data.map(r => {
      const from = players.find(p => p.id === r.referring_player_id);
      const to   = players.find(p => p.id === r.referred_player_id);
      return `
        <tr>
          <td>${fmtDate(r.created_at)}</td>
          <td>${from?.name || '—'}</td>
          <td>${to?.name || '—'}</td>
          <td class="chips-color"><strong>${fmt(r.chips_amount)}</strong></td>
          <td>${r.created_by || '—'}</td>
          <td><button class="btn btn-danger btn-xs" onclick="deleteRecord('blue_table_referrals','${r.id}','loadReferralsTable')">מחק</button></td>
        </tr>`;
    }).join('');
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
    const data = await dbGet('withdrawals', '?order=created_at.desc&select=*,players(name)');
    const tbody = document.getElementById('wd-table-body');
    if (!data || !data.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">אין רשומות בתקופה הנוכחית</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(r => `
      <tr>
        <td>${r.withdrawal_date || fmtDate(r.created_at)}</td>
        <td>${r.players?.name || '—'}</td>
        <td class="positive-color"><strong>₪${fmt(r.amount_ils)}</strong></td>
        <td class="chips-color">${fmt(r.chips_amount)}</td>
        <td>${r.created_by || '—'}</td>
        <td><button class="btn btn-danger btn-xs" onclick="deleteRecord('withdrawals','${r.id}','loadWithdrawalsTable')">מחק</button></td>
      </tr>`).join('');
  } catch (e) {
    showNotif('שגיאה בטעינת משיכות: ' + e.message, 'error');
  }
}

async function addWithdrawal() {
  const playerId = document.getElementById('wd-player').value;
  const date     = document.getElementById('wd-date').value;
  const ils      = parseFloat(document.getElementById('wd-ils').value);
  const chips    = parseFloat(document.getElementById('wd-chips').value);
  if (!playerId)        { showNotif('אנא בחר שחקן', 'error');           return; }
  if (!date)            { showNotif('אנא בחר תאריך', 'error');          return; }
  if (!ils || ils <= 0) { showNotif('אנא הזן סכום בש"ח תקין', 'error'); return; }
  if (!chips || chips <= 0){ showNotif('אנא הזן כמות צ\'יפים', 'error'); return; }

  try {
    await dbPost('withdrawals', {
      player_id: playerId, withdrawal_date: date,
      amount_ils: ils, chips_amount: chips, created_by: getDisplayName()
    });
    document.getElementById('wd-ils').value   = '';
    document.getElementById('wd-chips').value = '';
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
      dbGet('blue_table_rakeback',  '?select=rakeback_amount'),
      dbGet('blue_table_tournaments','?select=prize_chips'),
      dbGet('blue_table_bonuses',   '?select=chips_amount'),
      dbGet('blue_table_referrals', '?select=chips_amount'),
      dbGet('withdrawals',          '?select=amount_ils')
    ]);

    const sum = (arr, key) => (arr || []).reduce((s, r) => s + (n(r[key])), 0);
    const totalChips = sum(rb,'rakeback_amount') + sum(tn,'prize_chips') + sum(bn,'chips_amount') + sum(ref,'chips_amount');
    const totalWd    = sum(wd,'amount_ils');

    setText('bt-total-chips',       fmt(totalChips) + ' צ\'יפים');
    setText('bt-total-ils',         '₪' + fmt(totalChips / 10));
    setText('bt-total-withdrawals', '₪' + fmt(totalWd));
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
    renderHistoryTable(data || []);
    renderProfitChart(data || []);
  } catch (e) {
    showNotif('שגיאה בטעינת היסטוריה: ' + e.message, 'error');
  }
}

function renderHistoryTable(data) {
  const tbody = document.getElementById('history-table-body');
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">אין נתוני היסטוריה</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(r => {
    const profitColor = n(r.profit_total) >= 0 ? 'positive-color' : 'negative-color';
    return `
    <tr>
      <td>${r.period_end || '—'}</td>
      <td class="col-hide-sm">${fmt(r.total_expenses_chips)} צ'</td>
      <td class="col-hide-sm">₪${fmt(r.total_withdrawals_ils)}</td>
      <td class="${profitColor}"><strong>₪${fmt(r.profit_total)}</strong></td>
      <td class="col-hide-sm">₪${fmt(r.profit_ido)}</td>
      <td class="col-hide-sm">₪${fmt(r.profit_maor)}</td>
      <td><span class="badge ${r.entry_type === 'manual_import' ? 'badge-manual' : 'badge-regular'}">${r.entry_type === 'manual_import' ? 'ייבוא ידני' : 'סגירה רגילה'}</span></td>
      <td class="col-hide-sm">${r.closed_by || '—'}</td>
      <td class="col-hide-xs" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.notes || '—'}</td>
      <td><button class="btn btn-danger btn-xs" onclick="deleteHistory('${r.id}')">מחק</button></td>
    </tr>`;
  }).join('');
}

function renderProfitChart(data) {
  const ctx = document.getElementById('profit-chart');
  if (!ctx) return;

  if (profitChart) { profitChart.destroy(); profitChart = null; }
  if (!data.length) return;

  const sorted  = [...data].sort((a, b) => new Date(a.period_end) - new Date(b.period_end));
  const labels  = sorted.map(r => r.period_end || '');
  const profits = sorted.map(r => n(r.profit_total));

  profitChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'רווח כללי (₪)',
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
            label: ctx => '₪' + fmt(ctx.raw)
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

function renderPlayersTable() {
  const tbody      = document.getElementById('players-table-body');
  const cardsBody  = document.getElementById('players-cards-body');
  const countEl    = document.getElementById('players-count');
  if (countEl) countEl.textContent = players.length;

  if (!players.length) {
    tbody.innerHTML     = '<tr><td colspan="6" class="empty-state">אין שחקנים רשומים</td></tr>';
    cardsBody.innerHTML = '<div class="empty-state">אין שחקנים רשומים</div>';
    return;
  }

  // — Desktop table rows —
  tbody.innerHTML = players.map(p => {
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
          <button class="btn btn-danger btn-xs" onclick="deletePlayer('${p.id}')">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  // — Mobile player cards —
  cardsBody.innerHTML = players.map(p => {
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
  const name       = document.getElementById('new-player-name').value.trim();
  const nickname   = document.getElementById('new-player-nickname').value.trim() || null;
  const rbVal      = document.getElementById('new-player-rakeback').value;
  const rb         = rbVal !== '' ? parseFloat(rbVal) : null;
  const withdrawal = document.getElementById('new-player-withdrawal').value || 'bit';

  if (!name) { showNotif('אנא הזן שם שחקן', 'error'); return; }
  if (rb !== null && (isNaN(rb) || rb < 0 || rb > 100)) {
    showNotif('אחוז החזר חייב להיות 0–100', 'error'); return;
  }

  try {
    const result = await dbPost('players', {
      name, nickname, rakeback_percent: rb, preferred_withdrawal: withdrawal
    });
    if (result && result[0]) players.push(result[0]);

    document.getElementById('new-player-name').value       = '';
    document.getElementById('new-player-nickname').value   = '';
    document.getElementById('new-player-rakeback').value   = '';
    document.getElementById('new-player-withdrawal').value = 'bit';

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
    // 1. Fetch totals from all blue tables
    const [rb, tn, bn, ref, wd] = await Promise.all([
      dbGet('blue_table_rakeback',  '?select=rakeback_amount'),
      dbGet('blue_table_tournaments','?select=prize_chips'),
      dbGet('blue_table_bonuses',   '?select=chips_amount'),
      dbGet('blue_table_referrals', '?select=chips_amount'),
      dbGet('withdrawals',          '?select=amount_ils')
    ]);

    const sumField = (arr, key) => (arr || []).reduce((s, r) => s + n(r[key]), 0);
    const totalExpenses = sumField(rb,'rakeback_amount') + sumField(tn,'prize_chips') +
                          sumField(bn,'chips_amount')    + sumField(ref,'chips_amount');
    const totalWd = sumField(wd, 'amount_ils');

    const cp     = currentPeriod;
    const liquid = n(cp.bit_maor) + n(cp.bit_ido) + n(cp.bit_ravit) + n(cp.bit_dorin) + n(cp.paybox) + n(cp.cashcash);
    const total  = liquid + n(cp.debt_ido) + n(cp.debt_maor);
    const chipsIls = n(cp.counter) / 10;
    const profitTotal = chipsIls - total;
    const profitHalf  = profitTotal / 2;

    // 2. Save snapshot to history
    await dbPost('history', {
      period_end: today(),
      total_expenses_chips: totalExpenses,
      total_withdrawals_ils: totalWd,
      profit_total: profitTotal,
      profit_ido: profitHalf,
      profit_maor: profitHalf,
      entry_type: 'regular',
      closed_by: getDisplayName(),
      notes: null
    });

    // 3. Reset current_period (bit/paybox/cashcash/debts/counter → 0)
    const resetData = {
      bit_maor: 0, bit_ido: 0, bit_ravit: 0, bit_dorin: 0,
      paybox: 0, cashcash: 0, debt_ido: 0, debt_maor: 0,
      counter: 0, updated_at: now()
    };
    await dbPatch('current_period', '?id=eq.1', resetData);
    Object.assign(currentPeriod, resetData);

    // 4. Delete all blue table records for this period
    await Promise.all([
      dbDelete('blue_table_rakeback',  '?id=not.is.null'),
      dbDelete('blue_table_tournaments','?id=not.is.null'),
      dbDelete('blue_table_bonuses',   '?id=not.is.null'),
      dbDelete('blue_table_referrals', '?id=not.is.null'),
      dbDelete('withdrawals',          '?id=not.is.null')
    ]);

    showNotif('✅ התקופה נסגרה ונשמרה בהיסטוריה!');
    await loadDashboard();

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

  // Profit per partner
  const liquid     = bitIdo + bitDorin + bitMaor + bitRavit + paybox + n(cp.cashcash);
  const chipsIls   = n(cp.counter) / 10;
  const profitEach = (chipsIls - liquid) / 2;

  setText('st-profit-each', '₪' + fmt(profitEach));

  // Team totals
  const ipoExtra  = (settlementUsePaybox && owner === 'ido')  ? paybox : 0;
  const maorExtra = (settlementUsePaybox && owner === 'maor') ? paybox : 0;
  const teamIdo   = bitIdo + bitDorin + ipoExtra;
  const teamMaor  = bitMaor + bitRavit + maorExtra;

  setText('st-total-ido',  '₪' + fmt(teamIdo));
  setText('st-total-maor', '₪' + fmt(teamMaor));

  // Transfer calculation
  const transfer = profitEach - teamIdo;
  renderSettlementResult(transfer, profitEach);
}

function renderSettlementResult(transfer, profitEach) {
  const label  = document.getElementById('st-result-label');
  const amount = document.getElementById('st-result-amount');
  const sub    = document.getElementById('st-result-sub');
  if (!label || !amount || !sub) return;

  const abs = Math.abs(transfer);

  if (Math.abs(transfer) < 0.5) {
    label.textContent  = 'אין צורך בהעברות';
    amount.textContent = '✓';
    amount.style.color = 'var(--positive)';
    sub.textContent    = 'כל שותף ימשוך את יתרתו ישירות';
  } else if (transfer > 0) {
    label.textContent  = 'מאור מעביר לעידו';
    amount.textContent = '₪' + fmt(abs);
    amount.style.color = 'var(--accent)';
    sub.innerHTML      = `מאור מעביר לעידו <strong>₪${fmt(abs)}</strong> דרך ביט<br>` +
                         `מאור ימשוך לעצמו <strong>₪${fmt(profitEach)}</strong> מהביט שלו`;
  } else {
    label.textContent  = 'עידו מעביר למאור';
    amount.textContent = '₪' + fmt(abs);
    amount.style.color = 'var(--warning)';
    sub.innerHTML      = `עידו מעביר למאור <strong>₪${fmt(abs)}</strong> דרך ביט<br>` +
                         `עידו ימשוך לעצמו <strong>₪${fmt(profitEach)}</strong> מהביט שלו`;
  }
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
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const user = getCurrentUser();
  if (user) {
    mountApp();
  } else {
    document.getElementById('login-page').style.display = 'flex';
    document.getElementById('app').style.display        = 'none';
  }
});
