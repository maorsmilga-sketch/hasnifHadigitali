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
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById('page-' + page);
  const navEl  = document.querySelector(`[data-page="${page}"]`);

  if (pageEl) pageEl.classList.add('active');
  if (navEl)  navEl.classList.add('active');

  closeSidebar();
  loadPageData(page);
}

async function loadPageData(page) {
  try {
    switch (page) {
      case 'dashboard':  await loadDashboard();  break;
      case 'funds':      await loadFunds();       break;
      case 'blue-table': await loadBlueTable();   break;
      case 'debts':      await loadDebts();       break;
      case 'history':    await loadHistory();     break;
      case 'players':    await loadPlayers();     break;
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
  const profit   = chipsIls - total;
  const half     = profit / 2;

  setText('val-liquid',     fmt(liquid));
  setText('val-total',      fmt(total));
  setText('val-chips-ils',  fmt(chipsIls));
  setText('val-profit',     fmt(profit));
  setText('val-profit-ido', fmt(half));
  setText('val-profit-maor',fmt(half));

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
      <td>${fmt(r.total_expenses_chips)} צ'</td>
      <td>₪${fmt(r.total_withdrawals_ils)}</td>
      <td class="${profitColor}"><strong>₪${fmt(r.profit_total)}</strong></td>
      <td>₪${fmt(r.profit_ido)}</td>
      <td>₪${fmt(r.profit_maor)}</td>
      <td><span class="badge ${r.entry_type === 'manual_import' ? 'badge-manual' : 'badge-regular'}">${r.entry_type === 'manual_import' ? 'ייבוא ידני' : 'סגירה רגילה'}</span></td>
      <td>${r.closed_by || '—'}</td>
      <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.notes || '—'}</td>
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
async function loadPlayers() {
  try {
    players = (await dbGet('players', '?order=name.asc')) || [];
    renderPlayersTable();
  } catch (e) {
    showNotif('שגיאה בטעינת שחקנים: ' + e.message, 'error');
  }
}

function renderPlayersTable() {
  const tbody = document.getElementById('players-table-body');
  if (!players.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">אין שחקנים רשומים</td></tr>';
    return;
  }
  tbody.innerHTML = players.map(p => `
    <tr id="pr-${p.id}">
      <td>
        <span id="pname-${p.id}">${escHtml(p.name)}</span>
        <input id="pname-edit-${p.id}" value="${escHtml(p.name)}" style="display:none"
               class="inline-edit">
      </td>
      <td>
        <span id="prb-${p.id}">${p.rakeback_percent}%</span>
        <input id="prb-edit-${p.id}" type="number" value="${p.rakeback_percent}" min="0" max="100"
               style="display:none;width:70px" class="inline-edit">
      </td>
      <td>${fmtDate(p.created_at)}</td>
      <td>
        <div class="action-row">
          <button id="edit-btn-${p.id}" class="btn btn-secondary btn-xs" onclick="toggleEditPlayer('${p.id}')">✏️ ערוך</button>
          <button id="save-btn-${p.id}" class="btn btn-success btn-xs" style="display:none" onclick="savePlayer('${p.id}')">💾 שמור</button>
          <button class="btn btn-danger btn-xs" onclick="deletePlayer('${p.id}')">🗑️ מחק</button>
        </div>
      </td>
    </tr>`).join('');

  // Style inline edits
  document.querySelectorAll('.inline-edit').forEach(el => {
    Object.assign(el.style, {
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border)',
      borderRadius: '6px',
      padding: '4px 8px',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font)',
      fontSize: '13px',
      direction: 'rtl'
    });
  });
}

function toggleEditPlayer(id) {
  const nameSpan  = document.getElementById(`pname-${id}`);
  const nameInput = document.getElementById(`pname-edit-${id}`);
  const rbSpan    = document.getElementById(`prb-${id}`);
  const rbInput   = document.getElementById(`prb-edit-${id}`);
  const editBtn   = document.getElementById(`edit-btn-${id}`);
  const saveBtn   = document.getElementById(`save-btn-${id}`);
  const editing   = nameInput.style.display !== 'none';

  nameInput.style.display = editing ? 'none' : '';
  nameSpan.style.display  = editing ? '' : 'none';
  rbInput.style.display   = editing ? 'none' : '';
  rbSpan.style.display    = editing ? '' : 'none';
  editBtn.textContent     = editing ? '✏️ ערוך' : '❌ ביטול';
  saveBtn.style.display   = editing ? 'none' : '';
}

async function savePlayer(id) {
  const name = document.getElementById(`pname-edit-${id}`).value.trim();
  const rb   = parseFloat(document.getElementById(`prb-edit-${id}`).value);
  if (!name) { showNotif('אנא הזן שם שחקן', 'error'); return; }
  if (isNaN(rb) || rb < 0 || rb > 100) { showNotif('אחוז החזר חייב להיות 0–100', 'error'); return; }

  try {
    await dbPatch('players', `?id=eq.${id}`, { name, rakeback_percent: rb });
    const p = players.find(pl => pl.id === id);
    if (p) { p.name = name; p.rakeback_percent = rb; }
    renderPlayersTable();
    showNotif('✅ שחקן עודכן');
  } catch (e) {
    showNotif('שגיאה: ' + e.message, 'error');
  }
}

async function addPlayer() {
  const name = document.getElementById('new-player-name').value.trim();
  const rb   = parseFloat(document.getElementById('new-player-rakeback').value) || 60;
  if (!name) { showNotif('אנא הזן שם שחקן', 'error'); return; }

  try {
    const result = await dbPost('players', { name, rakeback_percent: rb });
    if (result && result[0]) players.push(result[0]);
    document.getElementById('new-player-name').value      = '';
    document.getElementById('new-player-rakeback').value  = '60';
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
// MOBILE SIDEBAR
// ============================================================
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('show');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
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
