/* Event expenses: independent state; ordinary expense posting is atomic in scoped RPCs. */
window.EventExpenses = (() => {
  const categories = {alcohol:'אלכוהול',pizza:'פיצות',snacks:'חטיפים / נשנושים',venue:'תשלום למקום',other:'אחר'};
  const payers = {maor:'מאור',ido:'עידו',branch:'הסניף'};
  const methods = {bit:'ביט',cash:'מזומן',paybox:'פייבוקס'};
  const money = value => '₪'+new Intl.NumberFormat('he-IL',{maximumFractionDigits:2}).format(Number(value)||0);
  const esc = value => escHtml(String(value ?? ''));
  let events=[], items=[], interest=[], selected=null, tab='expenses', archive=false, ready=false;
  let busy=false, dirty=false, timer=null, editing=null, receiptEditing=null, error='', loadSeq=0, retrySave=null, pendingKind=null;
  const el = id => document.getElementById(id);
  const uuid = () => crypto.randomUUID();
  function totals(rows) {
    const sums={maor:0,ido:0,branch:0};
    // Integer agorot avoid accumulated binary floating-point error.
    rows.forEach(r=>{sums[r.payer] += Math.round(Number(r.amount_ils)*100);});
    const personal=sums.maor+sums.ido;
    return {maor:sums.maor/100,ido:sums.ido/100,branch:sums.branch/100,total:(personal+sums.branch)/100,
      personal:personal/100,half:personal/200,transfer:Math.abs(sums.maor-sums.ido)/200,
      from:sums.maor>sums.ido?'ido':sums.ido>sums.maor?'maor':null,to:sums.maor>sums.ido?'maor':sums.ido>sums.maor?'ido':null};
  }
  function status(text, bad=false) {
    document.querySelectorAll('#ev-status, #page-event-expenses .ev-inline-status').forEach(node=>{
      node.textContent=text;node.classList.toggle('ev-error',bad);node.setAttribute('role',bad?'alert':'status');
      if(bad&&retrySave){const retry=document.createElement('button');retry.className='ev-link';retry.textContent='נסה לשמור שוב';retry.onclick=()=>retrySave();node.appendChild(retry);}
      if(bad&&selected){const reload=document.createElement('button');reload.className='ev-link';reload.textContent='טען את הגרסה השמורה';reload.onclick=reloadSaved;node.appendChild(reload);}
    });
  }
  async function reloadSaved(){
    if(busy)return;
    if(dirty&&!confirm('לטעון את הגרסה האחרונה שנשמרה? שינויים שטרם נשמרו יאבדו.'))return;
    const id=selected?.id;clearTimeout(timer);dirty=false;error='';editing=null;receiptEditing=null;
    if(id)await select(id);else await open();
  }
  function blocked() {
    if(busy){status('שומר שינויים…');return true;}
    if(dirty){status(error || 'יש שינוי שטרם נשמר. השלם שדות תקינים ונסה שוב לפני יציאה',true);return true;}
    return false;
  }
  async function rpc(name,data) {
    if(busy) return null;
    busy=true; error='';status('שומר…');
    const enabled=[...document.querySelectorAll('#page-event-expenses input:not(:disabled), #page-event-expenses select:not(:disabled), #page-event-expenses [data-ev-action]:not(:disabled)')];
    enabled.forEach(n=>n.disabled=true);
    try { const result=await sbRpc(name,data);status('נשמר');return result || []; }
    catch(e){error='השמירה לא הושלמה: '+e.message;status(error,true);return null;}
    finally{busy=false;enabled.forEach(n=>{if(n.isConnected)n.disabled=false;});}
  }
  function header() {
    return `<div class="ev-heading"><div><p class="ev-eyebrow">הוצאות / אירוע</p><h1>${selected?esc(selected.name):'אירועים'}</h1>${selected?`<p class="ev-note ev-date-location">${esc(fmtDate(selected.event_date))}${selected.location?' · '+esc(selected.location):''}</p>`:''}</div><span class="ev-badge">${selected?(selected.archived?'בארכיון':'אירוע פעיל'):'ניהול אירועים'}</span></div>
      <div id="ev-status" class="ev-status" role="status">${error?esc(error):'נשמר'}</div>`;
  }
  function mount() {
    const root=el('page-event-expenses');
    root.innerHTML=header()+(selected?detail():list());
    if(error)status(error,true);
    if(selected) {
      el('ev-meta')?.addEventListener('input',()=>schedule('meta'));
      initPlayerAC('ev-player-wrap','ev-player',p=>!interest.some(r=>r.player_id===p.id)||receiptEditing?.player_id===p.id);
    }
  }
  function list() {
    if(!ready)return '<div class="ev-panel ev-empty">לא ניתן לטעון אירועים. נדרשת התחברות והקמת האחסון החד־פעמית.<button class="ev-button" onclick="EventExpenses.open()">נסה שוב</button></div>';
    const shown=events.filter(e=>!!e.archived===archive);
    return `<div class="ev-switch"><button class="${!archive?'active':''}" onclick="EventExpenses.filter(false)">פעילים</button><button class="${archive?'active':''}" onclick="EventExpenses.filter(true)">ארכיון</button></div>
      <section class="ev-panel"><h2>אירוע חדש</h2><form id="ev-create" onsubmit="event.preventDefault();EventExpenses.create()">
      <label>שם האירוע<input id="ev-new-name" maxlength="160" placeholder="למשל: ערב חברים" required></label>
      <div class="ev-two"><label>תאריך האירוע<input id="ev-new-date" type="date" required></label><label>מיקום<input id="ev-new-location" maxlength="300" placeholder="מיקום האירוע"></label></div>
      <button class="ev-button primary" data-ev-action type="submit">＋ צור אירוע</button></form></section>
      <div class="ev-section-title">${archive?'אירועים בארכיון':'האירועים הפעילים'} <span>${shown.length}</span></div>
      <div class="ev-event-list">${shown.map(e=>`<button class="ev-event-card" onclick="EventExpenses.select('${e.id}')"><span class="ev-event-symbol">◈</span><span><strong>${esc(e.name)}</strong><small>${esc(fmtDate(e.event_date))}${e.location?' · '+esc(e.location):''}</small></span><span aria-hidden="true">‹</span></button>`).join('')||'<div class="ev-panel ev-empty">אין אירועים ברשימה הזו</div>'}</div>`;
  }
  function detail() {
    const s=selected, readonly=(s.archived||editing||receiptEditing)?'disabled':'';
    return `<section class="ev-panel"><div class="ev-inline-heading"><h2>פרטי האירוע</h2><button class="ev-link" data-ev-action onclick="EventExpenses.setArchive()">${s.archived?'החזר לפעילים':'העבר לארכיון'}</button></div>
      <form id="ev-meta" onsubmit="event.preventDefault();EventExpenses.saveMeta()"><label>שם האירוע<input id="ev-name" value="${esc(s.name)}" maxlength="160" required ${readonly}></label>
      <div class="ev-two"><label>תאריך האירוע<input type="date" id="ev-date" value="${esc(s.event_date)}" required ${readonly}></label><label>מיקום<input id="ev-location" value="${esc(s.location)}" maxlength="300" ${readonly}></label></div></form>
      ${s.archived?'<p class="ev-note">האירוע נשמר לצפייה. אפשר להחזיר אותו לפעילים ללא רישום הוצאות מחדש.</p>':''}</section>
      <div class="ev-switch"><button class="${tab==='expenses'?'active':''}" onclick="EventExpenses.switchTab('expenses')">הוצאות</button><button class="${tab==='interest'?'active':''}" onclick="EventExpenses.switchTab('interest')">מתעניינים ותשלומים</button></div>
      <div id="ev-tab-content">${tab==='expenses'?expensesView():interestView()}</div>`;
  }
  function expensesView() {
    return `<div class="ev-section-title">רשימת הוצאות <span>${items.length}</span></div>
      <p class="ev-note">כל הוצאה נרשמת פעם אחת גם בהוצאות הכלליות, בקטגוריית אירוע.</p>
      <div class="ev-rows">${items.map(r=>`<article class="ev-row"><div><strong>${esc(categories[r.category==='food'?'snacks':r.category])}</strong>${r.description?`<p>${esc(r.description)}</p>`:''}<small>${esc(payers[r.payer])} שילם${r.closed_history_id?' · תקופה סגורה':''}</small></div><div class="ev-row-end"><b dir="ltr">${money(r.amount_ils)}</b>${!selected.archived&&!r.closed_history_id?`<div><button class="ev-link" data-ev-action onclick="EventExpenses.editItem('${r.id}')">ערוך</button><button class="ev-link danger" data-ev-action onclick="EventExpenses.deleteItem('${r.id}')">מחק</button></div>`:'<span class="ev-lock">לצפייה בלבד</span>'}</div></article>`).join('')||'<div class="ev-panel ev-empty">עדיין אין הוצאות באירוע</div>'}</div>
      ${!selected.archived?`<section class="ev-panel" id="ev-item-editor">${itemForm()}</section>`:''}
      <div id="ev-summary">${summary()}</div>`;
  }
  function itemForm() {
    const r=editing || {category:'pizza',description:'',amount_ils:'',payer:'maor'};
    return `<h2>${editing?'עריכת הוצאה':'הוצאה חדשה'}</h2><form id="ev-item-form" onsubmit="event.preventDefault();EventExpenses.saveItem()">
      <div class="ev-two"><label>קטגוריה<select id="ev-category" onchange="EventExpenses.itemChanged()">${Object.entries(categories).map(([v,l])=>`<option value="${v}" ${(r.category==='food'?'snacks':r.category)===v?'selected':''}>${l}</option>`).join('')}</select></label><label>סכום (₪)<input type="number" id="ev-amount" inputmode="decimal" min="0.01" max="999999999999.99" step="0.01" value="${r.amount_ils}" required oninput="EventExpenses.itemChanged()"></label></div>
      <label>תיאור <span id="ev-desc-hint">${r.category==='other'?'(חובה)':'(לא חובה)'}</span><input id="ev-description" maxlength="500" value="${esc(r.description)}" oninput="EventExpenses.itemChanged()"></label>
      <fieldset class="ev-payer"><legend>מי שילם?</legend>${Object.entries(payers).map(([v,l])=>`<label><input type="radio" name="ev-payer" value="${v}" ${r.payer===v?'checked':''} onchange="EventExpenses.itemChanged()"><span>${l}</span></label>`).join('')}</fieldset>
      <button class="ev-button primary" data-ev-action type="submit">${editing?'שמור שינויים':'＋ הוסף הוצאה'}</button>${editing?'<button class="ev-button" type="button" onclick="EventExpenses.cancelEditor()">סיים עריכה</button>':''}
      <div class="ev-inline-status" role="status"></div><p class="ev-note">${editing?'שינויים תקינים נשמרים אוטומטית.':'הוספה שומרת גם את ההוצאה החד־פעמית.'}</p></form>`;
  }
  function summary(override) {
    const rows=items.map(r=>override?.id===r.id?override:r), t=totals(rows);
    return `<section class="ev-panel ev-totals"><p class="ev-eyebrow">סיכום האירוע</p><span class="ev-total-label">סה״כ הוצאות אירוע</span><strong class="ev-grand" dir="ltr">${money(t.total)}</strong><div class="ev-payer-totals">${Object.entries(payers).map(([key,label])=>`<div><span>${label} שילם</span><b dir="ltr">${money(t[key])}</b></div>`).join('')}</div><div class="ev-summary-line"><span>הוצאות אישיות להתקזזות</span><b dir="ltr">${money(t.personal)}</b></div><div class="ev-summary-line"><span>חלקו של כל אחד (50%)</span><b dir="ltr">${money(t.half)}</b></div><p class="ev-note">הוצאות הסניף נכללות בסה״כ בלבד, ללא התקזזות.</p></section>
      <section class="ev-settlement"><h2>מי מעביר למי?</h2>${t.from?`<p>${payers[t.from]} מעביר ל${payers[t.to]}</p><strong dir="ltr">${money(t.transfer)}</strong>`:'<p>אין צורך בהעברה</p>'}<small>חישוב לתצוגה בלבד. לא מתבצעת העברה בפועל.</small></section>`;
  }
  function interestView() {
    const paid=interest.filter(r=>r.paid), paidTotal=paid.reduce((v,r)=>v+Math.round(Number(r.amount_ils)*100),0)/100;
    const r=receiptEditing || {amount_ils:50,paid:false,method:null};
    return `<section class="ev-panel"><div class="ev-inline-heading"><h2>מתעניינים ותשלומים</h2><span class="ev-badge">לתיעוד בלבד</span></div><div class="ev-interest-stats"><div><b>${interest.length}</b><span>מתעניינים</span></div><div><b>${paid.length}</b><span>שילמו</span></div><div><b dir="ltr">${money(paidTotal)}</b><span>התקבל</span></div></div><button class="ev-button" type="button" data-ev-action onclick="EventExpenses.shareSummary()">שיתוף סיכום</button><p class="ev-note">הרישום אינו משפיע על יתרות, חובות, רווח או התקזזות. התעניינות אינה אישור השתתפות.</p><div class="ev-method-totals">${Object.entries(methods).map(([v,l])=>`<span>${l} <b dir="ltr">${money(paid.filter(x=>x.method===v).reduce((s,x)=>s+Math.round(Number(x.amount_ils)*100),0)/100)}</b></span>`).join('')}</div></section>
      <div class="ev-rows">${interest.map(x=>`<article class="ev-row"><div><strong>${esc(x.player_name)}</strong><p class="${x.paid?'ev-paid':'ev-unpaid'}">${x.paid?'שולם · '+methods[x.method]:'לא שולם'}</p></div><div class="ev-row-end"><b dir="ltr">${money(x.amount_ils)}</b>${!selected.archived?`<div><button class="ev-link" data-ev-action onclick="EventExpenses.editInterest('${x.id}')">ערוך</button><button class="ev-link danger" data-ev-action onclick="EventExpenses.deleteInterest('${x.id}')">הסר</button></div>`:''}</div></article>`).join('')||'<div class="ev-panel ev-empty">לא נוספו מתעניינים עדיין</div>'}</div>
      ${!selected.archived?`<section class="ev-panel" id="ev-interest-editor"><h2>${receiptEditing?'עריכת רישום':'הוסף מתעניין'}</h2><form id="ev-interest-form" onsubmit="event.preventDefault();EventExpenses.saveInterest()"><label>שחקן<div class="player-ac-wrap" id="ev-player-wrap"><input class="player-ac-input" placeholder="חפש ברשימת השחקנים…" autocomplete="off" value="${esc(receiptEditing?.player_name||'')}" ${receiptEditing?'disabled':''}><input type="hidden" id="ev-player" value="${receiptEditing?.player_id||''}"><ul class="player-ac-list"></ul></div></label><div class="ev-two"><label>סכום (₪)<input id="ev-receipt-amount" type="number" inputmode="decimal" min="0.01" max="999999999999.99" step="0.01" value="${r.amount_ils}" required oninput="EventExpenses.receiptChanged()"></label><label>מצב תשלום<select id="ev-paid" onchange="EventExpenses.receiptChanged()"><option value="false" ${!r.paid?'selected':''}>לא שולם</option><option value="true" ${r.paid?'selected':''}>שולם</option></select></label></div><label id="ev-method-label" ${!r.paid?'hidden':''}>אופן תשלום<select id="ev-method" onchange="EventExpenses.receiptChanged()"><option value="">בחר אופן תשלום</option>${Object.entries(methods).map(([v,l])=>`<option value="${v}" ${r.method===v?'selected':''}>${l}</option>`).join('')}</select></label><button class="ev-button primary" data-ev-action type="submit">${receiptEditing?'שמור שינויים':'＋ הוסף לרשימה'}</button>${receiptEditing?'<button class="ev-button" type="button" onclick="EventExpenses.cancelEditor()">סיים עריכה</button>':''}<div class="ev-inline-status" role="status"></div></form></section>`:''}`;
  }
  function buildInterestSummary() {
    const paid=interest.filter(r=>r.paid), unpaid=interest.filter(r=>!r.paid);
    const paidTotal=paid.reduce((sum,r)=>sum+Math.round(Number(r.amount_ils)*100),0)/100;
    const lines=[`סיכום מתעניינים ותשלומים — ${selected.name}`,
      `תאריך: ${fmtDate(selected.event_date)}`,
      ...(selected.location?[`מיקום: ${selected.location}`]:[]),
      '',`שילמו (${paid.length}):`];
    paid.forEach(r=>lines.push(`• ${r.player_name} — ${money(r.amount_ils)} · ${methods[r.method]||'אופן תשלום לא צוין'}`));
    if(!paid.length)lines.push('עדיין אין תשלומים');
    lines.push('',`מתעניינים שטרם שילמו (${unpaid.length}):`);
    unpaid.forEach(r=>lines.push(`• ${r.player_name}`));
    if(!unpaid.length)lines.push('אין מתעניינים שטרם שילמו');
    lines.push('',`סה״כ מתעניינים: ${interest.length}`,`סה״כ שילמו: ${paid.length}`,`סה״כ התקבל: ${money(paidTotal)}`);
    return lines.join('\n');
  }
  async function shareSummary() {
    if(!selected||blocked())return;
    const text=buildInterestSummary();
    if(typeof navigator.share==='function') {
      try { await navigator.share({text});return; }
      catch(e) { if(e?.name==='AbortError')return; }
    }
    // Same manual recipient chooser as attendance management. Never sends automatically.
    window.location.href='https://wa.me/?text='+encodeURIComponent(text);
  }
  async function open(id) {
    const seq=++loadSeq;
    clearTimeout(timer);selected=null;editing=null;receiptEditing=null;dirty=false;error='';
    el('page-event-expenses').innerHTML='<div class="ev-panel ev-empty" role="status">טוען אירועים…</div>';
    try {
      events=await dbGet('event_expense_events','?order=event_date.desc,created_at.desc');
      if(seq!==loadSeq)return;
      ready=true;
      if(id)await select(id);else mount();
    }catch(e){if(seq!==loadSeq)return;ready=false;error='לא ניתן לטעון: '+e.message;mount();}
  }
  async function select(id) {
    if(blocked())return;
    const candidate=events.find(e=>e.id===id);
    if(!candidate){status('האירוע לא נמצא',true);return;}
    const seq=++loadSeq; status('טוען אירוע…');
    try{
      const [fresh,rows,receipts,ps]=await Promise.all([dbGet('event_expense_events','?id=eq.'+id),dbGet('event_expense_items','?event_id=eq.'+id+'&order=created_at.asc'),dbGet('event_expense_interest','?event_id=eq.'+id+'&order=created_at.asc'),dbGet('players','?order=name.asc')]);
      if(seq!==loadSeq)return;
      if(!fresh[0])throw Error('האירוע לא נמצא');
      selected=fresh[0];items=rows;interest=receipts;players=ps;editing=null;receiptEditing=null;error='';mount();
    }catch(e){status('לא ניתן לפתוח אירוע: '+e.message,true);}
  }
  async function create(){
    retrySave=create;
    const form=el('ev-create');if(busy||!form.reportValidity())return;
    const id=uuid(), data={id,name:el('ev-new-name').value.trim(),event_date:el('ev-new-date').value,location:el('ev-new-location').value.trim()};
    if(!data.name)return;
    // Retain operation identity on network failure, so retry never creates a second event.
    data.id=form.dataset.id || (form.dataset.id=id);
    const result=await rpc('event_expense_save_event',{p_data:data});
    if(result){events.unshift(result[0]);await select(result[0].id);}
  }
  function schedule(kind) {
    pendingKind=kind;dirty=true;error='';status('שינויים טרם נשמרו');clearTimeout(timer);
    timer=setTimeout(()=>{if(busy){schedule(kind);return;} if(kind==='meta')saveMeta();else if(kind==='item')saveItem();else saveInterest();},650);
  }
  async function saveMeta(){
    retrySave=saveMeta;
    if(busy||!selected)return;
    const data={...selected,name:el('ev-name').value.trim(),event_date:el('ev-date').value,location:el('ev-location').value.trim(),expected_updated_at:selected.updated_at};
    if(!data.name||!data.event_date){status('שם ותאריך אירוע הם שדות חובה',true);return;}
    const version=JSON.stringify(data),result=await rpc('event_expense_save_event',{p_data:data});
    if(result){selected=result[0];events=events.map(e=>e.id===selected.id?selected:e);
      const current=JSON.stringify({...data,name:el('ev-name').value.trim(),event_date:el('ev-date').value,location:el('ev-location').value.trim()});
      dirty=current!==version;if(dirty)schedule('meta');
      el('page-event-expenses').querySelector('.ev-heading h1').textContent=selected.name;
      el('page-event-expenses').querySelector('.ev-date-location').textContent=fmtDate(selected.event_date)+(selected.location?' · '+selected.location:'');
    }
  }
  function itemData(){
    const amount=Number(el('ev-amount')?.value),category=el('ev-category')?.value,description=el('ev-description')?.value.trim();
    if(!Number.isFinite(amount)||amount<=0||amount>=1e12||Math.abs(amount*100-Math.round(amount*100))>0.0001||!categories[category]||(category==='other'&&!description))return null;
    return {id:editing?.id || el('ev-item-form').dataset.id || (el('ev-item-form').dataset.id=uuid()),event_id:selected.id,category,description,amount_ils:amount,payer:document.querySelector('[name="ev-payer"]:checked').value,expected_updated_at:editing?.updated_at||null};
  }
  function itemChanged(){
    const other=el('ev-category').value==='other';el('ev-desc-hint').textContent=other?'(חובה)':'(לא חובה)';el('ev-description').required=other;
    const data=itemData();if(editing){if(data)el('ev-summary').innerHTML=summary(data);schedule('item');}
  }
  async function saveItem(){
    if(dirty&&pendingKind==='meta'){clearTimeout(timer);await saveMeta();if(dirty||busy)return;}
    retrySave=saveItem;pendingKind='item';
    clearTimeout(timer);if(busy)return;
    const data=itemData();if(!data){status('יש להזין סכום תקין ותיאור בקטגוריית אחר',true);return;}
    const result=await rpc('event_expense_save_item',{p_data:data});
    if(result){
      const fresh=result[0], wasEditing=!!editing, current=itemData();
      items=items.some(r=>r.id===fresh.id)?items.map(r=>r.id===fresh.id?fresh:r):[...items,fresh];
      const changed=current&&['category','description','amount_ils','payer'].some(k=>current[k]!==data[k]);
      if(wasEditing&&changed){editing=fresh;dirty=true;schedule('item');return;}
      editing=wasEditing?fresh:null;dirty=false;mount();
      if(wasEditing)el('ev-item-editor')?.scrollIntoView({block:'nearest'});
    }else {dirty=true;document.querySelectorAll('#ev-meta input').forEach(n=>n.disabled=true);}
  }
  async function editItem(id){if(blocked())return;editing={...items.find(r=>r.id===id)};mount();el('ev-item-editor').scrollIntoView({block:'center'});}
  async function deleteItem(id){
    if(blocked())return;const row=items.find(r=>r.id===id);
    if(!confirm('למחוק את ההוצאה ואת הרישום שלה בהוצאות הכלליות של התקופה הפתוחה?'))return;
    const result=await rpc('event_expense_delete_item',{p_id:id,p_expected_updated_at:row.updated_at});
    if(result){items=items.filter(r=>r.id!==id);editing=null;mount();}
  }
  function receiptChanged(){
    const paid=el('ev-paid').value==='true';el('ev-method-label').hidden=!paid;el('ev-method').required=paid;
    if(receiptEditing)schedule('interest');
  }
  function receiptData(){
    const form=el('ev-interest-form'),playerId=el('ev-player').value,player=players.find(p=>p.id===playerId),amount=Number(el('ev-receipt-amount').value),paid=el('ev-paid').value==='true',method=paid?el('ev-method').value:null;
    if(!playerId||(!player&&!receiptEditing)||!Number.isFinite(amount)||amount<=0||amount>=1e12||Math.abs(amount*100-Math.round(amount*100))>0.0001||(paid&&!methods[method]))return null;
    return {id:receiptEditing?.id||form.dataset.id||(form.dataset.id=uuid()),event_id:selected.id,player_id:playerId,player_name:receiptEditing?.player_name||player.nickname||player.name,amount_ils:amount,paid,method,expected_updated_at:receiptEditing?.updated_at||null};
  }
  async function saveInterest(){
    if(dirty&&pendingKind==='meta'){clearTimeout(timer);await saveMeta();if(dirty||busy)return;}
    retrySave=saveInterest;pendingKind='interest';
    clearTimeout(timer);if(busy)return;const data=receiptData();if(!data){status('בחר שחקן, סכום תקין ואופן תשלום אם שולם',true);return;}
    if(!receiptEditing&&interest.some(r=>r.player_id===data.player_id)){status('השחקן כבר ברשימת המתעניינים',true);return;}
    const result=await rpc('event_expense_save_interest',{p_data:data});
    if(result){const fresh=result[0],wasEditing=!!receiptEditing,current=receiptData();interest=interest.some(r=>r.id===fresh.id)?interest.map(r=>r.id===fresh.id?fresh:r):[...interest,fresh];
      if(wasEditing&&current&&['amount_ils','paid','method'].some(k=>current[k]!==data[k])){receiptEditing=fresh;dirty=true;schedule('interest');return;}
      receiptEditing=wasEditing?fresh:null;dirty=false;mount();if(wasEditing)el('ev-interest-editor')?.scrollIntoView({block:'nearest'});
    }else {dirty=true;document.querySelectorAll('#ev-meta input').forEach(n=>n.disabled=true);}
  }
  function editInterest(id){if(blocked())return;receiptEditing={...interest.find(r=>r.id===id)};mount();el('ev-interest-editor').scrollIntoView({block:'center'});}
  async function deleteInterest(id){if(blocked()||!confirm('להסיר את המתעניין ואת רישום התשלום שלו מהאירוע?'))return;const row=interest.find(r=>r.id===id);const result=await rpc('event_expense_delete_interest',{p_id:id,p_expected_updated_at:row.updated_at});if(result){interest=interest.filter(r=>r.id!==id);receiptEditing=null;mount();}}
  async function setArchive(){
    if(blocked())return;
    if(!confirm(selected.archived?'להחזיר את האירוע לרשימת הפעילים?':'להעביר לארכיון? כל הפירוט יישמר. ההוצאות הקיימות לא יימחקו ולא יירשמו מחדש.'))return;
    const result=await rpc('event_expense_save_event',{p_data:{...selected,archived:!selected.archived,expected_updated_at:selected.updated_at}});
    if(result){selected=result[0];events=events.map(e=>e.id===selected.id?selected:e);editing=null;receiptEditing=null;mount();}
  }
  function back(){if(blocked())return;if(selected){archive=!!selected.archived;selected=null;editing=null;receiptEditing=null;mount();window.scrollTo({top:0});}else openBlueGrid();}
  function switchTab(which){if(blocked())return;tab=which;editing=null;receiptEditing=null;mount();}
  function filter(which){if(blocked())return;archive=which;mount();}
  function cancelEditor(){if(blocked())return;editing=null;receiptEditing=null;mount();}
  document.addEventListener('click',e=>{if(!el('page-event-expenses')?.classList.contains('active'))return;if((dirty||busy)&&e.target.closest('#home-btn, .btn-logout-top, #tab-contacts, #tab-management')){e.preventDefault();e.stopImmediatePropagation();blocked();}},true);
  function reset(){archive=false;tab='expenses';retrySave=null;++loadSeq;clearTimeout(timer);events=[];items=[];interest=[];selected=null;editing=null;receiptEditing=null;dirty=false;busy=false;ready=false;error='';el('page-event-expenses')?.replaceChildren();}
  window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
  return {open,select,create,back,switchTab,filter,saveMeta,saveItem,itemChanged,editItem,deleteItem,saveInterest,receiptChanged,editInterest,deleteInterest,setArchive,cancelEditor,reset,totals,shareSummary};
})();
