'use strict';

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
const fmt = new Intl.NumberFormat('vi-VN');
const money = n => `${fmt.format(Math.round(Number(n)||0))} ₫`;
const signedMoney = n => `${n>0?'+':n<0?'−':''}${money(Math.abs(n))}`;
const vndDigits = value => String(value ?? '').replace(/[^0-9-]/g,'');
function parseMoneyInput(value,{allowNegative=false}={}){
  const raw=vndDigits(value); const negative=allowNegative && raw.startsWith('-');
  const digits=raw.replace(/-/g,''); if(!digits)return 0;
  const n=Number(digits); return Number.isFinite(n)?(negative?-n:n):0;
}
function formatMoneyInput(value,{allowNegative=false}={}){
  const n=parseMoneyInput(value,{allowNegative});
  if(!n && !String(value??'').match(/\d/)) return '';
  return `${n<0?'-':''}${fmt.format(Math.abs(Math.trunc(n)))}`;
}
function bindMoneyInput(input){
  if(!input || input.dataset.moneyBound==='1')return;
  input.dataset.moneyBound='1'; const allowNegative=input.dataset.allowNegative==='1';
  const apply=()=>{
    const before=input.value, start=input.selectionStart ?? before.length;
    const digitsBefore=before.slice(0,start).replace(/\D/g,'').length;
    const negative=allowNegative && before.trim().startsWith('-');
    input.value=formatMoneyInput(before,{allowNegative});
    let pos=negative?1:0, seen=0;
    while(pos<input.value.length && seen<digitsBefore){ if(/\d/.test(input.value[pos]))seen++; pos++; }
    try{input.setSelectionRange(pos,pos);}catch{}
  };
  input.addEventListener('input',apply);
  input.addEventListener('blur',()=>{input.value=formatMoneyInput(input.value,{allowNegative});});
  input.value=formatMoneyInput(input.value,{allowNegative});
}
function bindMoneyInputs(root=document){ $$('[data-money-input]',root).forEach(bindMoneyInput); }
function moneyField(id,value='',opts={}){
  const negative=opts.allowNegative?' data-allow-negative="1"':'';
  const required=opts.required?' required':'';
  const placeholder=opts.placeholder?` placeholder="${esc(opts.placeholder)}"`:'';
  return `<span class="money-field-wrap"><input id="${id}" data-money-input="1"${negative} inputmode="numeric" autocomplete="off" value="${esc(value)}"${placeholder}${required}><span class="money-suffix">VND</span></span>`;
}
const esc = (s='') => String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const MONTHS = ['Tháng Một','Tháng Hai','Tháng Ba','Tháng Tư','Tháng Năm','Tháng Sáu','Tháng Bảy','Tháng Tám','Tháng Chín','Tháng Mười','Tháng Mười Một','Tháng Mười Hai'];
const CATEGORIES = ['Ăn uống','Di chuyển','Mua sắm','Hóa đơn','Nhà ở','Sức khỏe','Giải trí','Học tập','Gia đình','Quà tặng','Du lịch','Công việc','Khác'];
const INCOME_CATEGORIES = ['Lương','Thưởng','Làm thêm','Kinh doanh','Hoàn tiền','Quà tặng','Thu nhập khác'];
const MOODS = ['Bình yên','Vui','Ổn','Háo hức','Mệt','Buồn','Căng thẳng','Khó tả'];

const app = {
  csrf:null,
  data:null,
  route:'home',
  currentMonth:new Date().toISOString().slice(0,7),
  quickType:'expense',
  txFilter:'all',
  txQuery:'',
  dailyDate:new Date().toISOString().slice(0,10),
  dailyMediaIds:[],
  dailyMediaDate:null,
  privateId:null,
  calendarDate:new Date().toISOString().slice(0,10),
  settingsSection:'profile',
  institutions:[],
  lastActivity:Date.now(),
  privateSaveTimer:null,
  nativeStatus:{}
};

const authScreen = $('#authScreen');
const appShell = $('#appShell');
const loginForm = $('#loginForm');
const setupForm = $('#setupForm');
const pageWrap = $('#pageWrap');
const quickBackdrop = $('#quickBackdrop');
const formBackdrop = $('#formBackdrop');
const formBody = $('#formBody');
const commandBackdrop = $('#commandBackdrop');
const toastStack = $('#toastStack');

async function api(path, opts={}){
  const headers = new Headers(opts.headers||{});
  if(app.csrf && !['GET','HEAD'].includes((opts.method||'GET').toUpperCase())) headers.set('x-csrf-token', app.csrf);
  if(opts.json !== undefined){ headers.set('content-type','application/json'); opts.body=JSON.stringify(opts.json); delete opts.json; }
  const res = await fetch(path,{...opts,headers,credentials:'same-origin'});
  if(res.status===204) return null;
  const ct=res.headers.get('content-type')||'';
  if(!res.ok){
    let msg=`Lỗi ${res.status}`;
    if(ct.includes('application/json')){ try{ const j=await res.json(); msg=j.error||msg; }catch{} }
    throw new Error(msg);
  }
  if(ct.includes('application/json')) return res.json();
  return res;
}

function toast(message,type='ok'){
  const el=document.createElement('div'); el.className=`toast ${type==='error'?'error':''}`; el.textContent=message; toastStack.append(el);
  setTimeout(()=>el.remove(),3200);
}
function onError(err){ console.error(err); toast(err?.message||'Có lỗi xảy ra.','error'); }
function monthLabel(key=app.currentMonth){ const [y,m]=key.split('-').map(Number); return `${MONTHS[m-1]} ${y}`; }
function dateLabel(iso){ if(!iso)return ''; const d=new Date(`${iso}T12:00:00`); return new Intl.DateTimeFormat('vi-VN',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(d); }
function shortDate(iso){ if(!iso)return ''; const d=new Date(`${iso}T12:00:00`); return new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'}).format(d); }
function sameMonth(date,month=app.currentMonth){return String(date||'').slice(0,7)===month;}
function accountById(id){return app.data?.accounts.find(a=>a.id===id);}
function txTitle(t){ return t.note?.trim() || (t.type==='expense'?t.category:t.type==='income'?t.category:'Chuyển tiền'); }
function sensitive(v){return `<span class="sensitive">${esc(v)}</span>`;}
function nowMonth(){return new Date().toISOString().slice(0,7);}

function monthStats(month=app.currentMonth){
  const plan=Number(app.data?.monthPlans?.[month]?.total||0);
  const tx=(app.data?.transactions||[]).filter(t=>sameMonth(t.date,month));
  const expenses=tx.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const incomeExtra=tx.filter(t=>t.type==='income'&&t.addToMonth).reduce((s,t)=>s+t.amount,0);
  const incomeRecorded=tx.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  const available=plan+incomeExtra;
  const remaining=available-expenses;
  return {plan,expenses,incomeExtra,incomeRecorded,available,remaining,tx};
}
function categorySpend(month=app.currentMonth){
  const map={}; for(const t of (app.data?.transactions||[])){ if(t.type==='expense'&&sameMonth(t.date,month)) map[t.category]=(map[t.category]||0)+t.amount; }
  return Object.entries(map).sort((a,b)=>b[1]-a[1]);
}
function accountBalances(){ return (app.data?.accounts||[]).filter(a=>!a.archived); }
function budgetUsed(b){ return (app.data?.transactions||[]).filter(t=>t.type==='expense'&&t.category===b.category&&sameMonth(t.date,b.month)).reduce((s,t)=>s+t.amount,0); }

async function boot(){
  try{
    const status=await api('/api/status'); app.csrf=status.csrf; app.nativeStatus=status.native||{}; updateBiometricLogin();
    if(status.setupRequired){ setupForm.hidden=false; loginForm.hidden=true; authScreen.hidden=false; appShell.hidden=true; }
    else if(!status.authenticated){ loginForm.hidden=false; setupForm.hidden=true; authScreen.hidden=false; appShell.hidden=true; }
    else await enterApp();
  }catch(err){
    authScreen.hidden=false; setupForm.hidden=true; loginForm.hidden=false; $('#loginError').textContent='Không mở được kho dữ liệu cục bộ. Hãy đóng và mở lại ứng dụng.';
  }
}
async function enterApp(){
  const payload=await api('/api/data'); app.csrf=payload.csrf||app.csrf; app.data=payload.data;
  const inst=await api('/api/institutions'); app.institutions=inst.data||[]; app.nativeStatus=await LocalAPI.status(); updateBiometricLogin();
  $('#institutionList').innerHTML=app.institutions.map(x=>`<option value="${esc(x)}"></option>`).join('');
  authScreen.hidden=true; appShell.hidden=false; $('#mobileNav').hidden=false;
  app.currentMonth = Object.keys(app.data.monthPlans||{}).sort().pop() || nowMonth();
  app.dailyDate=new Date().toISOString().slice(0,10); app.calendarDate=app.dailyDate;
  applySettings(); render(app.route||'home'); resetActivity();
}
async function refreshData({renderNow=true}={}){ const p=await api('/api/data'); app.data=p.data; app.csrf=p.csrf||app.csrf; if(renderNow) render(app.route,false); }

setupForm.addEventListener('submit',async e=>{e.preventDefault();$('#setupError').textContent='';if($('#setupPassword').value!==$('#setupPasswordConfirm').value){$('#setupError').textContent='Hai mật khẩu không khớp.';return;}try{const r=await api('/api/setup',{method:'POST',json:{name:$('#setupName').value,password:$('#setupPassword').value}});app.csrf=r.csrf;app.nativeStatus=await LocalAPI.status();await enterApp();}catch(err){$('#setupError').textContent=err.message;}});
loginForm.addEventListener('submit',async e=>{e.preventDefault();$('#loginError').textContent='';try{const r=await api('/api/login',{method:'POST',json:{password:$('#loginPassword').value}});app.csrf=r.csrf;$('#loginPassword').value='';await enterApp();}catch(err){$('#loginError').textContent=err.message;}});
$('#biometricLogin')?.addEventListener('click',async()=>{$('#loginError').textContent='';try{await LocalAPI.unlockBiometric();app.nativeStatus=await LocalAPI.status();await enterApp();}catch(err){$('#loginError').textContent=err.message;}});
function updateBiometricLogin(){const b=$('#biometricLogin');if(!b)return;b.hidden=!(app.nativeStatus?.biometricAvailable&&app.nativeStatus?.biometricEnabled);}

function applySettings(){
  document.body.classList.toggle('privacy-on',Boolean(app.data?.settings?.privacy));
  document.body.classList.toggle('evening',Boolean(app.data?.settings?.evening));
  const privacyButton=$('#privacyButton');
  if(privacyButton){privacyButton.classList.toggle('active',Boolean(app.data?.settings?.privacy));privacyButton.setAttribute('aria-pressed',String(Boolean(app.data?.settings?.privacy)));}
}
async function saveSetting(patch){ try{const r=await api('/api/settings',{method:'PUT',json:patch}); app.data.settings=r.data; applySettings(); render(app.route,false);}catch(err){onError(err);} }

function pageHead(label,title,subtitle,actions=''){
  return `<div class="page-head"><div class="page-head-copy"><span class="eyebrow">${esc(label)}</span><h1 class="page-title">${title}</h1>${subtitle?`<p class="page-subtitle">${subtitle}</p>`:''}</div><div class="page-actions">${actions}</div></div>`;
}
function monthControls(){ return `<div class="month-switcher"><button data-prev-month aria-label="Tháng trước">‹</button><span>${esc(monthLabel())}</span><button data-next-month aria-label="Tháng sau">›</button></div>`; }

function homePage(){
  const s=monthStats(); const top=categorySpend().slice(0,3); const daily=(app.data.dailyEntries||[]).find(e=>e.date===app.dailyDate);
  return `<section class="home-hero">
    <div class="hero-media"><img class="ambient-scene" src="./assets/visuals/window-scene.webp" alt="" decoding="async"></div>
    <div class="hero-copy"><div class="hero-kicker">${esc(dateLabel(new Date().toISOString().slice(0,10)))}</div><h1 class="hero-title">Chào ${esc(app.data.settings.displayName||'bạn')},<br>mọi thứ đang ở đây.</h1><p>Một nơi nhẹ nhàng để theo dõi tiền tháng này và lưu lại những điều bạn muốn nhớ.</p><button class="button-primary" data-route="daily" data-compose-journal="1">Viết nhật ký hôm nay</button><div class="hero-balance"><span class="money sensitive">${money(s.remaining)}</span><small>còn lại trong ${monthLabel().toLowerCase()}</small></div></div>
    <div class="hero-floating"><div class="float-head"><strong>Chi tiêu theo nhóm</strong><span>${s.expenses?Math.round(s.expenses/Math.max(s.available,1)*100):0}% tiền tháng</span></div><div class="float-bars">${top.length?top.map(([c,v],i)=>`<div class="float-row"><span>${esc(c)}</span><div class="mini-track"><i class="c${i+1}" style="width:${Math.min(100,v/Math.max(top[0][1],1)*100)}%"></i></div><b class="sensitive">${money(v)}</b></div>`).join(''):'<p class="page-subtitle">Chưa có khoản chi nào.</p>'}</div><div class="float-foot"><span>Tổng tiền tháng</span><b class="sensitive">${money(s.plan)}</b></div></div>
  </section>
  <section class="section-grid"><div class="metric-row"><div class="metric-card"><span class="metric-label">Tổng tiền tháng</span><strong class="sensitive">${money(s.plan)}</strong><small>Khoản bạn chủ động nhập</small></div><div class="metric-card"><span class="metric-label">Đã chi</span><strong class="sensitive">${money(s.expenses)}</strong><small>${s.plan?Math.round(s.expenses/s.plan*100):0}% tổng tiền ban đầu</small></div><div class="metric-card"><span class="metric-label">Thu thêm đã cộng</span><strong class="sensitive">${money(s.incomeExtra)}</strong><small>Chỉ những khoản bạn chọn cộng vào tháng</small></div></div>
  <article class="paper-card home-journal"><div class="journal-visual"></div><div class="card-pad"><span class="eyebrow">NHẬT KÝ HÔM NAY</span><h3>${esc(daily?.title||'Hôm nay có gì đáng nhớ?')}</h3><p>${esc((daily?.body||'Viết vài dòng, chọn tâm trạng và thêm bao nhiêu ảnh tùy thích.').slice(0,150))}</p><div class="journal-meta"><span class="pill">${esc(daily?.mood||'Chưa chọn tâm trạng')}</span><button class="button-soft" data-route="daily" data-compose-journal="1">Mở nhật ký</button></div></div></article>
  <article class="paper-card cashflow-card"><div class="card-pad"><div class="card-title-row"><h3>Dòng tiền ${esc(monthLabel().toLowerCase())}</h3><button class="text-button" data-route="insights">Phân tích</button></div></div><div class="card-pad"><div class="finance-equation"><div class="equation-card"><span>Tổng tiền</span><b class="sensitive">${money(s.plan)}</b></div><div class="equation-op">+</div><div class="equation-card"><span>Thu thêm</span><b class="sensitive">${money(s.incomeExtra)}</b></div><div class="equation-op">−</div><div class="equation-card"><span>Đã chi</span><b class="sensitive">${money(s.expenses)}</b></div></div></div></article>
  <article class="paper-card goals-card"><div class="card-pad"><div class="card-title-row"><h3>Mục tiêu</h3><button class="text-button" data-route="goals">Tất cả</button></div>${(app.data.goals||[]).slice(0,3).map(g=>goalMini(g)).join('')||'<div class="empty-state"><strong>Chưa có mục tiêu.</strong><p>Khi cần, tạo một mục tiêu để theo dõi tiến độ riêng.</p></div>'}</div></article></section>`;
}
function goalMini(g){ const pct=Math.min(100,Math.round(g.current/Math.max(g.target,1)*100)); return `<div class="goal-mini"><img src="./assets/visuals/${pct>60?'goal-travel':'goal-laptop'}.webp" alt=""><div><h4>${esc(g.name)}</h4><div class="goal-num"><span class="sensitive">${money(g.current)} / ${money(g.target)}</span><span>${pct}%</span></div><progress value="${pct}" max="100"></progress></div></div>`; }

function moneyPage(){
  const s=monthStats(), accounts=accountBalances();
  const subtitle=`${esc(monthLabel())} · Bạn nhập tổng tiền có thể dùng trong tháng. Mỗi khoản chi sẽ tự trừ khỏi số còn lại; chuyển tiền giữa các tài khoản không làm giảm số này.`;
  const actions=`${monthControls()}<button class="button-soft" data-set-month-total>Chỉnh tổng tiền tháng</button><button class="button-primary" data-open-quick>＋ Thêm giao dịch</button>`;
  return `${pageHead('TÀI CHÍNH','Tài chính',subtitle,actions)}
  <div class="finance-top-grid"><article class="paper-card month-balance-card"><div class="balance-kicker"><span class="pill">Còn lại trong tháng</span><span class="pill">Tự động tính</span></div><div class="balance-main sensitive">${money(s.remaining)}</div><p class="balance-explain">Tổng tiền tháng + thu nhập thêm được chọn cộng vào tháng − toàn bộ chi tiêu trong tháng.</p><div class="finance-mini-stats"><div class="finance-mini-stat"><span>TỔNG TIỀN THÁNG</span><b class="sensitive">${money(s.plan)}</b></div><div class="finance-mini-stat"><span>ĐÃ CHI</span><b class="sensitive">${money(s.expenses)}</b></div><div class="finance-mini-stat"><span>THU THÊM</span><b class="sensitive">${money(s.incomeExtra)}</b></div></div></article>
  <aside class="paper-card accounts-card"><div class="card-title-row"><h3>Tài khoản & ngân hàng</h3><button class="text-button" data-add-account>＋ Thêm</button></div><div class="accounts-list">${accounts.map(a=>`<div class="account-row"><span class="institution-badge">${esc((a.institution||a.name).slice(0,1).toUpperCase())}</span><div class="account-copy"><strong>${esc(a.name)}</strong><small>${esc(a.institution||'Tài khoản')}</small></div><b class="account-amount sensitive">${money(a.balance)}</b><div class="row-actions"><button class="tiny-button" data-edit-account="${a.id}" title="Sửa">✎</button></div></div>`).join('')||'<div class="empty-state"><strong>Chưa có tài khoản.</strong></div>'}</div></aside></div>
  <article class="paper-card" style="margin-top:18px;padding:28px"><div class="card-title-row"><h3>Cách tính trong tháng</h3><span class="pill">Dễ kiểm tra</span></div><div class="finance-equation"><div class="equation-card"><span>Tổng tiền bạn nhập</span><b class="sensitive">${money(s.plan)}</b></div><div class="equation-op">+</div><div class="equation-card"><span>Thu thêm</span><b class="sensitive">${money(s.incomeExtra)}</b></div><div class="equation-op">−</div><div class="equation-card"><span>Chi tiêu</span><b class="sensitive">${money(s.expenses)}</b></div></div><p class="page-subtitle" style="margin-top:14px">Ví dụ bạn nhập 10.000.000 ₫ cho tháng này, sau đó chi 45.000 ₫ cà phê thì số còn lại tự thành 9.955.000 ₫. Chuyển 1.000.000 ₫ từ Vietcombank sang MoMo không làm thay đổi số còn lại.</p></article>`;
}

function transactionsPage(){
  let tx=[...(app.data.transactions||[])].sort((a,b)=>b.date.localeCompare(a.date)||String(b.createdAt).localeCompare(String(a.createdAt)));
  if(app.txFilter!=='all')tx=tx.filter(t=>t.type===app.txFilter);
  if(app.txQuery){const q=app.txQuery.toLowerCase();tx=tx.filter(t=>`${t.note} ${t.category} ${accountById(t.accountId)?.name||''}`.toLowerCase().includes(q));}
  const groups={}; for(const t of tx){(groups[t.date] ||= []).push(t);}
  return `${pageHead('GIAO DỊCH','Giao dịch','Toàn bộ khoản thu, chi và chuyển tiền. Chuyển tiền chỉ đổi nơi giữ tiền, không tính vào chi tiêu.',`<button class="button-primary" data-open-quick>＋ Thêm giao dịch</button>`)}
  <div class="transactions-toolbar"><div class="segmented">${[['all','Tất cả'],['expense','Chi tiêu'],['income','Thu nhập'],['transfer','Chuyển tiền']].map(([k,l])=>`<button class="${app.txFilter===k?'active':''}" data-tx-filter="${k}">${l}</button>`).join('')}</div><input class="filter-input" id="txSearch" value="${esc(app.txQuery)}" placeholder="Tìm theo ghi chú, danh mục, tài khoản..."></div>
  <article class="paper-card transaction-table">${Object.keys(groups).length?Object.entries(groups).map(([date,items])=>`<div class="transaction-date-group">${esc(dateLabel(date))}</div>${items.map(t=>txRow(t)).join('')}`).join(''):'<div class="empty-state"><div class="empty-icon">↕</div><strong>Chưa có giao dịch.</strong><p>Thêm khoản chi đầu tiên để số tiền còn lại được cập nhật tự động.</p><button class="button-primary" data-open-quick>＋ Thêm giao dịch</button></div>'}</article>`;
}
function txRow(t){
  const a=accountById(t.accountId), to=accountById(t.toAccountId); const amount=t.type==='expense'?-t.amount:t.type==='income'?t.amount:0;
  return `<div class="transaction-row"><span class="tx-icon">${t.type==='expense'?'−':t.type==='income'?'+':'↔'}</span><div class="tx-main"><strong>${esc(txTitle(t))}</strong><small>${esc(t.category)}</small></div><span class="tx-meta">${esc(a?.name||'—')}${t.type==='transfer'?` → ${esc(to?.name||'—')}`:''}</span><b class="tx-amount ${t.type} sensitive">${t.type==='transfer'?money(t.amount):signedMoney(amount)}</b><div class="row-actions"><button class="tiny-button" data-edit-tx="${t.id}">Sửa</button><button class="tiny-button" data-delete-tx="${t.id}">Xóa</button></div></div>`;
}

function budgetsPage(){
  const list=(app.data.budgets||[]).filter(b=>b.month===app.currentMonth); const total=list.reduce((s,b)=>s+b.limit,0), used=list.reduce((s,b)=>s+budgetUsed(b),0); const daysLeft=Math.max(1,new Date(Number(app.currentMonth.slice(0,4)),Number(app.currentMonth.slice(5,7)),0).getDate()-new Date().getDate()+1); const remaining=Math.max(0,total-used);
  const subtitle=`${esc(monthLabel())} · Đặt giới hạn theo từng nhóm để dễ theo dõi. Chi tiêu thực tế tự cập nhật vào đúng danh mục.`;
  const actions=`${monthControls()}<button class="button-primary" data-add-budget>＋ Thêm ngân sách</button>`;
  return `${pageHead('NGÂN SÁCH','Ngân sách',subtitle,actions)}
  <div class="budget-overview"><article class="paper-card budget-kpi"><span class="eyebrow">TỔNG NGÂN SÁCH</span><strong class="sensitive">${money(total)}</strong><p class="page-subtitle">Đã dùng ${money(used)} · còn ${money(remaining)}</p><progress value="${Math.min(100,used/Math.max(total,1)*100)}" max="100"></progress></article><article class="paper-card budget-kpi"><span class="eyebrow">TRUNG BÌNH CÓ THỂ CHI / NGÀY</span><strong class="sensitive">${money(Math.floor(remaining/daysLeft))}</strong><p class="page-subtitle">Dựa trên phần ngân sách còn lại và khoảng ${daysLeft} ngày còn lại. Chỉ là gợi ý, không ép hạn mức.</p></article></div>
  <article class="paper-card budget-list-card">${list.length?list.map(b=>{const u=budgetUsed(b),pct=Math.min(100,Math.round(u/b.limit*100));return `<div class="budget-row"><div><b>${esc(b.category)}</b><small class="page-subtitle">${pct}% đã dùng</small></div><div class="budget-progress"><progress value="${pct}" max="100"></progress><small>${money(u)} / ${money(b.limit)}</small></div><b class="sensitive">${money(b.limit)}</b><b class="sensitive">${money(Math.max(0,b.limit-u))}</b><div class="row-actions"><button class="tiny-button" data-edit-budget="${b.id}">Sửa</button><button class="tiny-button" data-delete-budget="${b.id}">Xóa</button></div></div>`}).join(''):'<div class="empty-state"><div class="empty-icon">▤</div><strong>Chưa có ngân sách trong tháng này.</strong><p>Bạn có thể tạo ngân sách cho Ăn uống, Di chuyển, Mua sắm hoặc bất kỳ danh mục nào.</p><button class="button-primary" data-add-budget>＋ Thêm ngân sách</button></div>'}</article>`;
}

function monthCalendarButtons(selected){
  const [y,m]=app.currentMonth.split('-').map(Number), first=new Date(y,m-1,1), days=new Date(y,m,0).getDate(), offset=(first.getDay()+6)%7; let out='';
  for(let i=0;i<offset;i++)out+='<span></span>';
  for(let d=1;d<=days;d++){const iso=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;out+=`<button class="${iso===selected?'active':''}" data-daily-date="${iso}">${d}</button>`;}
  return out;
}
function dailyPage(){
  const entry=(app.data.dailyEntries||[]).find(e=>e.date===app.dailyDate)||{date:app.dailyDate,title:'',body:'',mood:'',mediaIds:[]}; if(app.dailyMediaDate!==app.dailyDate){app.dailyMediaIds=[...(entry.mediaIds||[])];app.dailyMediaDate=app.dailyDate;}
  const hist=[...(app.data.dailyEntries||[])].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,20);
  const media=app.dailyMediaIds.map(id=>app.data.media.find(m=>m.id===id)).filter(Boolean);
  return `${pageHead('NHẬT KÝ','Nhật ký','Viết về một ngày, chọn tâm trạng và thêm ảnh. Không giới hạn số lượng ảnh trong một ngày; ảnh được mã hóa và lưu cục bộ trên thiết bị.',`${monthControls()}<button class="button-soft" data-daily-today>Hôm nay</button>`)}
  <div class="daily-layout-v4"><aside class="paper-card daily-sidebar"><div class="card-title-row"><h3>${esc(monthLabel())}</h3></div><div class="daily-calendar">${['T2','T3','T4','T5','T6','T7','CN'].map(x=>`<span>${x}</span>`).join('')}${monthCalendarButtons(app.dailyDate)}</div><span class="eyebrow">NHỮNG NGÀY ĐÃ VIẾT</span><div class="daily-history">${hist.map(e=>`<button class="${e.date===app.dailyDate?'active':''}" data-daily-date="${e.date}"><small>${esc(shortDate(e.date))} · ${esc(e.mood||'Không ghi mood')}</small><b>${esc(e.title||'Một ngày chưa đặt tên')}</b></button>`).join('')||'<p class="page-subtitle">Chưa có ngày nào được lưu.</p>'}</div></aside>
  <article class="paper-card daily-editor"><div class="daily-topline"><div><span class="eyebrow">${esc(dateLabel(app.dailyDate))}</span></div><div class="page-actions"><button class="button-ghost" data-delete-daily ${entry.id?'':'disabled'}>Xóa ngày này</button><button class="button-primary" data-save-daily>Lưu nhật ký</button></div></div><input class="daily-title-input" id="dailyTitle" maxlength="200" value="${esc(entry.title)}" placeholder="Hôm nay có gì đáng nhớ?"><textarea class="daily-body-input" id="dailyBody" maxlength="100000" placeholder="Viết những gì bạn muốn giữ lại...">${esc(entry.body)}</textarea>
  <span class="eyebrow">TÂM TRẠNG</span><div class="mood-row">${MOODS.map(m=>`<button class="mood-chip ${entry.mood===m?'active':''}" data-mood="${esc(m)}">${esc(m)}</button>`).join('')}</div>
  <div class="photo-zone"><div class="photo-zone-head"><div><span class="eyebrow">ẢNH CỦA NGÀY</span><div class="unlimited-note">Không giới hạn số ảnh. Mỗi ảnh tối đa 25 MB và được mã hóa trước khi lưu trên thiết bị.</div></div><label class="button-soft" for="dailyPhotos">＋ Thêm ảnh</label></div><input id="dailyPhotos" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple hidden><div class="photo-grid">${media.map(m=>`<div class="photo-tile"><img src="${LocalAPI.mediaURL(m.id)}" alt="${esc(m.name)}"><button class="photo-remove" data-remove-photo="${m.id}" title="Bỏ khỏi ngày này">×</button></div>`).join('')}<label class="photo-add" for="dailyPhotos"><span>＋ Thêm ảnh</span></label></div><div class="upload-status" id="uploadStatus"></div></div></article></div>`;
}

function privatePage(){
  const entries=[...(app.data.privateEntries||[])].sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))); if(!app.privateId&&entries[0])app.privateId=entries[0].id; const cur=entries.find(e=>e.id===app.privateId)||null;
  return `${pageHead('NHẬT KÝ CÁ NHÂN','Nhật ký cá nhân','Không giới hạn độ dài theo ngày. Đây là nơi viết dài, tâm sự hoặc lưu những suy nghĩ riêng.',`<button class="button-primary" data-new-private>＋ Trang mới</button>`)}
  <div class="private-layout-v4"><aside class="paper-card private-index"><span class="eyebrow">CÁC TRANG</span><input class="private-search" id="privateSearch" placeholder="Tìm trong nhật ký..."><div class="private-list" id="privateList">${entries.map(e=>`<button class="private-entry-button ${e.id===app.privateId?'active':''}" data-private-id="${e.id}"><small>${esc(new Date(e.updatedAt||e.createdAt).toLocaleString('vi-VN'))}</small><b>${esc(e.title||'Trang chưa đặt tên')}</b></button>`).join('')||'<p class="page-subtitle">Chưa có trang nào.</p>'}</div></aside>
  <article class="paper-card private-paper">${cur?`<div class="daily-topline"><span class="pill">Chỉ bạn đọc được</span><div class="page-actions"><button class="button-ghost" data-delete-private>Xóa trang</button><button class="button-primary" data-save-private>Lưu</button></div></div><input id="privateTitle" maxlength="300" value="${esc(cur.title)}" placeholder="Đặt tên cho trang này"><textarea id="privateBody" maxlength="200000" placeholder="Viết bất cứ điều gì...">${esc(cur.body)}</textarea><div class="private-foot"><span id="privateCount">${countWords(cur.body)} từ</span><span id="privateSaveState">Đã lưu</span></div>`:'<div class="empty-state"><div class="empty-icon">✎</div><strong>Chưa có trang nào.</strong><p>Tạo trang đầu tiên để bắt đầu viết.</p><button class="button-primary" data-new-private>＋ Trang mới</button></div>'}</article></div>`;
}
function countWords(s=''){return String(s).trim()?String(s).trim().split(/\s+/).length:0;}

function calendarPage(){
  const [y,m]=app.currentMonth.split('-').map(Number), days=new Date(y,m,0).getDate(), first=new Date(y,m-1,1), offset=(first.getDay()+6)%7; let cells=''; for(let i=0;i<offset;i++)cells+='<div class="calendar-v4-day muted"></div>';
  for(let d=1;d<=days;d++){const iso=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`, tx=(app.data.transactions||[]).filter(t=>t.date===iso), j=(app.data.dailyEntries||[]).find(e=>e.date===iso);cells+=`<button class="calendar-v4-day ${app.calendarDate===iso?'selected':''}" data-calendar-date="${iso}"><span class="num">${d}</span><div class="day-dots">${tx.length?'<i class="day-dot"></i>':''}${j?'<i class="day-dot journal"></i>':''}</div></button>`;}
  const txDay=(app.data.transactions||[]).filter(t=>t.date===app.calendarDate), jDay=(app.data.dailyEntries||[]).find(e=>e.date===app.calendarDate);
  return `${pageHead('LỊCH','Lịch','Xem giao dịch và nhật ký trên cùng một dòng thời gian.',monthControls())}<div class="calendar-v4-layout"><article class="paper-card calendar-main"><div class="calendar-week">${['T2','T3','T4','T5','T6','T7','CN'].map(x=>`<div>${x}</div>`).join('')}</div><div class="calendar-v4-grid">${cells}</div></article><aside class="paper-card day-summary"><span class="eyebrow">CHI TIẾT NGÀY</span><h3>${esc(dateLabel(app.calendarDate))}</h3>${txDay.length?txDay.map(t=>`<div class="day-event"><b>${esc(txTitle(t))} · <span class="sensitive">${t.type==='expense'?signedMoney(-t.amount):t.type==='income'?signedMoney(t.amount):money(t.amount)}</span></b><small>${esc(t.category)}</small></div>`).join(''):'<p class="page-subtitle">Không có giao dịch.</p>'}${jDay?`<div class="day-event"><b>Nhật ký · ${esc(jDay.mood||'Không ghi mood')}</b><small>${esc(jDay.title||'Một ngày đã được ghi lại')}</small><button class="button-soft" data-open-day="${jDay.date}" style="margin-top:8px">Mở nhật ký</button></div>`:''}</aside></div>`;
}

function goalsPage(){
  const goals=app.data.goals||[];
  return `${pageHead('MỤC TIÊU','Mục tiêu','Theo dõi những khoản bạn muốn dành riêng. Mục tiêu không tự trừ khỏi tổng tiền tháng trừ khi bạn ghi một khoản chi tương ứng.',`<button class="button-primary" data-add-goal>＋ Thêm mục tiêu</button>`)}<div class="goal-list-v4">${goals.map((g,i)=>{const pct=Math.min(100,Math.round(g.current/Math.max(g.target,1)*100));const img=['goal-travel.webp','goal-laptop.webp','goal-home.webp'][i%3];return `<article class="paper-card goal-v4"><img src="./assets/visuals/${img}" alt=""><div class="goal-v4-body"><div class="goal-v4-head"><h3>${esc(g.name)}</h3><span class="pill">${pct}%</span></div><div class="goal-money"><span class="sensitive">${money(g.current)}</span><span class="sensitive">${money(g.target)}</span></div><progress value="${pct}" max="100"></progress>${g.deadline?`<p class="page-subtitle">Mốc: ${esc(shortDate(g.deadline))}</p>`:''}<div class="goal-v4-actions"><button class="button-soft" data-edit-goal="${g.id}">Cập nhật</button><button class="button-ghost" data-delete-goal="${g.id}">Xóa</button></div></div></article>`}).join('')||'<article class="paper-card empty-state"><div class="empty-icon">◇</div><strong>Chưa có mục tiêu.</strong><p>Tạo mục tiêu cho chuyến đi, món đồ, quỹ dự phòng hoặc bất cứ điều gì bạn muốn.</p><button class="button-primary" data-add-goal>＋ Thêm mục tiêu</button></article>'}</div>`;
}

function insightsPage(){
  const s=monthStats(), cats=categorySpend(), txDays=new Set(s.tx.filter(t=>t.type==='expense').map(t=>t.date)).size, avg=txDays?Math.round(s.expenses/txDays):0, largest=Math.max(0,...s.tx.filter(t=>t.type==='expense').map(t=>t.amount)), journalCount=(app.data.dailyEntries||[]).filter(e=>sameMonth(e.date)).length;
  const maxCat=Math.max(1,...cats.map(x=>x[1]));
  const subtitle=`${esc(monthLabel())} · Các con số được lấy trực tiếp từ giao dịch và nhật ký của bạn.`;
  return `${pageHead('PHÂN TÍCH','Phân tích',subtitle,monthControls())}<div class="insight-kpis"><article class="paper-card insight-kpi"><span>CÒN LẠI</span><b class="sensitive">${money(s.remaining)}</b></article><article class="paper-card insight-kpi"><span>ĐÃ CHI</span><b class="sensitive">${money(s.expenses)}</b></article><article class="paper-card insight-kpi"><span>TRUNG BÌNH / NGÀY CÓ CHI</span><b class="sensitive">${money(avg)}</b></article><article class="paper-card insight-kpi"><span>NHẬT KÝ ĐÃ VIẾT</span><b>${journalCount} ngày</b></article></div><div class="insight-grid-v4"><article class="paper-card" style="padding:26px"><div class="card-title-row"><h3>Chi tiêu theo danh mục</h3><span class="pill">${cats.length} nhóm</span></div><div class="category-bars" style="margin-top:18px">${cats.map(([c,v])=>`<div class="category-bar-row"><span>${esc(c)}</span><div class="bar-track"><i style="width:${Math.round(v/maxCat*100)}%"></i></div><b class="sensitive">${money(v)}</b></div>`).join('')||'<div class="empty-state"><strong>Chưa có dữ liệu chi tiêu.</strong></div>'}</div></article><article class="paper-card" style="padding:26px"><div class="card-title-row"><h3>Nhìn nhanh</h3></div><div class="story-stat"><span>Tổng tiền tháng</span><b class="sensitive">${money(s.plan)}</b></div><div class="story-stat"><span>Thu thêm</span><b class="sensitive">${money(s.incomeExtra)}</b></div><div class="story-stat"><span>Khoản chi lớn nhất</span><b class="sensitive">${money(largest)}</b></div><div class="story-stat"><span>Số ngày có chi tiêu</span><b>${txDays} ngày</b></div></article></div>`;
}

function settingsPage(){
  const sec=app.settingsSection; const menu=[['profile','Tài khoản'],['appearance','Giao diện'],['security','Bảo mật'],['backup','Sao lưu']];
  let pane=''; if(sec==='profile')pane=`<section class="settings-section-v4"><h3>Thông tin cá nhân</h3><p>Tên này chỉ dùng bên trong Sổ.</p><div class="setting-v4-row"><div><b>Tên hiển thị</b><small>${esc(app.data.settings.displayName)}</small></div><button class="button-soft" data-edit-profile>Chỉnh sửa</button></div></section><section class="settings-section-v4"><h3>Tài khoản & ngân hàng</h3><p>Bạn có thể thêm ngân hàng từ danh sách hơn 50 ngân hàng/ví phổ biến hoặc tự nhập tên riêng.</p><div class="setting-v4-row"><div><b>Số tài khoản đang dùng</b><small>${accountBalances().length} tài khoản</small></div><button class="button-soft" data-add-account>＋ Thêm tài khoản</button></div></section>`;
  if(sec==='appearance')pane=`<section class="settings-section-v4"><h3>Giao diện</h3><p>Giữ thiết kế nhẹ và ít gây mệt khi dùng lâu.</p><div class="setting-v4-row"><div><b>Ẩn số tiền nhanh</b><small>Hữu ích khi chia sẻ màn hình.</small></div><button class="switch ${app.data.settings.privacy?'on':''}" data-toggle-privacy></button></div><div class="setting-v4-row"><div><b>Chế độ buổi tối</b><small>Tông tối ấm thay vì đen gắt.</small></div><button class="switch ${app.data.settings.evening?'on':''}" data-toggle-evening></button></div></section>`;
  if(sec==='security')pane=`<section class="settings-section-v4"><h3>Bảo mật</h3><p>Kho dữ liệu được mã hóa AES-256-GCM trên thiết bị. Mật khẩu chỉ dùng để mở khóa khóa chính.</p><div class="setting-v4-row"><div><b>Tự khóa khi không hoạt động</b><small>${app.data.settings.autoLockMinutes} phút</small></div><button class="button-soft" data-auto-lock>Chỉnh</button></div><div class="setting-v4-row"><div><b>Đổi mật khẩu</b><small>Đổi lớp bảo vệ mật khẩu mà không giải mã dữ liệu ra đĩa.</small></div><button class="button-soft" data-change-password>Đổi mật khẩu</button></div><div class="setting-v4-row"><div><b>Khóa ngay</b><small>Xóa khóa đang mở khỏi bộ nhớ.</small></div><button class="button-danger" data-logout>Khóa Sổ</button></div></section>`;
  if(sec==='backup')pane=`<section class="settings-section-v4"><h3>Sao lưu mã hóa</h3><p>Bản sao gồm dữ liệu và toàn bộ ảnh nhật ký, được mã hóa AES-256-GCM bằng mật khẩu riêng trước khi chia sẻ ra Files.</p><div class="setting-v4-row"><div><b>Xuất bản sao</b><small>Mở Share Sheet để lưu file .sobackup vào Files hoặc nơi bạn chọn.</small></div><button class="button-primary" data-export-backup>Xuất bản sao</button></div><div class="setting-v4-row"><div><b>Khôi phục</b><small>Khôi phục dữ liệu từ file .sobackup.</small></div><button class="button-soft" data-restore-backup>Chọn file</button></div></section>`;
  return `${pageHead('CÀI ĐẶT','Cài đặt','Quản lý tài khoản, giao diện, bảo mật và bản sao dữ liệu.')}<div class="settings-v4"><aside class="paper-card settings-menu">${menu.map(([k,l])=>`<button class="${sec===k?'active':''}" data-settings-section="${k}">${l}</button>`).join('')}</aside><article class="paper-card settings-pane">${pane}</article></div>`;
}

const pages={home:homePage,money:moneyPage,transactions:transactionsPage,budgets:budgetsPage,daily:dailyPage,private:privatePage,calendar:calendarPage,goals:goalsPage,insights:insightsPage,settings:settingsPage};

function render(route=app.route,scroll=true){
  if(!pages[route])route='home';
  app.route=route; pageWrap.dataset.route=route; pageWrap.innerHTML=pages[route](); bindPageEvents();
  $$('[data-route]').forEach(el=>el.classList.toggle('active',el.dataset.route===route));
  $$('.mobile-nav-item').forEach(el=>el.classList.toggle('active',el.dataset.route===route));
  try{sessionStorage.setItem('sorelax.route',route);}catch{}
  if(scroll)window.scrollTo({top:0,behavior:'auto'});
}
function focusDailyEditor(){
  const editor=$('#dailyBody'); if(!editor)return;
  try{editor.focus({preventScroll:true}); const n=editor.value.length; editor.setSelectionRange(n,n);}catch{editor.focus();}
  requestAnimationFrame(()=>editor.scrollIntoView({block:'center',behavior:'smooth'}));
}
function closeMore(){const el=$('#moreBackdrop');if(el)el.hidden=true;}
function navigate(route,{focusDaily=false}={}){ closeMore(); render(route); if(focusDaily&&route==='daily')focusDailyEditor(); }

function bindGlobal(){
  document.addEventListener('click',e=>{
    const r=e.target.closest('[data-route]');
    if(r){e.preventDefault();navigate(r.dataset.route,{focusDaily:r.dataset.composeJournal==='1'});}
  });
  $('#mobileMenu')?.addEventListener('click',()=>{$('#moreBackdrop').hidden=false;});
  $('#moreClose')?.addEventListener('click',closeMore);
  $('#moreBackdrop')?.addEventListener('click',e=>{if(e.target===$('#moreBackdrop'))closeMore();});
  $('#mobileQuickAdd')?.addEventListener('click',()=>openQuick('expense'));
  $('#privacyButton')?.addEventListener('click',()=>saveSetting({privacy:!app.data.settings.privacy}));
  $('#lockButton')?.addEventListener('click',()=>{closeMore();logout();});
  $('#searchTrigger')?.addEventListener('click',openCommand);
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openCommand();}if(e.key==='Escape'){closeQuick();closeForm();closeCommand();closeMore();}});
  $$('[data-close="quick"]').forEach(b=>b.addEventListener('click',closeQuick));
  $$('[data-close="form"]').forEach(b=>b.addEventListener('click',closeForm));
  $('[data-command-close]')?.addEventListener('click',closeCommand);
  $('.quick-tabs')?.addEventListener('click',e=>{const b=e.target.closest('[data-type]');if(!b)return;if(b.dataset.type==='journal'){closeQuick();navigate('daily',{focusDaily:true});return;}setQuickType(b.dataset.type);});
  $('#quickForm')?.addEventListener('submit',submitQuick);
  $('#commandInput')?.addEventListener('input',renderCommandResults);
  quickBackdrop?.addEventListener('click',e=>{if(e.target===quickBackdrop)closeQuick();});
  formBackdrop?.addEventListener('click',e=>{if(e.target===formBackdrop)closeForm();});
  commandBackdrop?.addEventListener('click',e=>{if(e.target===commandBackdrop)closeCommand();});
  document.addEventListener('focusin',e=>{if(e.target.matches?.('input,textarea,select,[contenteditable="true"]'))document.body.classList.add('keyboard-open');});
  document.addEventListener('focusout',()=>setTimeout(()=>{if(!document.activeElement?.matches?.('input,textarea,select,[contenteditable="true"]'))document.body.classList.remove('keyboard-open');},80));
  ['pointerdown','keydown','touchstart'].forEach(ev=>document.addEventListener(ev,resetActivity,{passive:true}));
  setInterval(checkAutoLock,30000);
}

function bindPageEvents(){
  $$('[data-open-quick]').forEach(b=>b.addEventListener('click',()=>openQuick('expense')));
  $$('[data-prev-month]').forEach(b=>b.addEventListener('click',()=>shiftMonth(-1))); $$('[data-next-month]').forEach(b=>b.addEventListener('click',()=>shiftMonth(1)));
  $('[data-set-month-total]')?.addEventListener('click',openMonthPlan);
  $$('[data-add-account]').forEach(b=>b.addEventListener('click',()=>openAccountForm())); $$('[data-edit-account]').forEach(b=>b.addEventListener('click',()=>openAccountForm(b.dataset.editAccount)));
  $$('[data-tx-filter]').forEach(b=>b.addEventListener('click',()=>{app.txFilter=b.dataset.txFilter;render('transactions',false);})); $('#txSearch')?.addEventListener('input',e=>{app.txQuery=e.target.value;render('transactions',false);$('#txSearch')?.focus();});
  $$('[data-edit-tx]').forEach(b=>b.addEventListener('click',()=>openTxEdit(b.dataset.editTx))); $$('[data-delete-tx]').forEach(b=>b.addEventListener('click',()=>confirmAction('Xóa giao dịch?','Giao dịch sẽ bị xóa khỏi số liệu tháng.',()=>deleteTx(b.dataset.deleteTx))));
  $$('[data-add-budget]').forEach(b=>b.addEventListener('click',()=>openBudgetForm())); $$('[data-edit-budget]').forEach(b=>b.addEventListener('click',()=>openBudgetForm(b.dataset.editBudget))); $$('[data-delete-budget]').forEach(b=>b.addEventListener('click',()=>confirmAction('Xóa ngân sách?','Giao dịch vẫn được giữ nguyên.',()=>deleteBudget(b.dataset.deleteBudget))));
  $$('[data-daily-date]').forEach(b=>b.addEventListener('click',()=>{app.dailyDate=b.dataset.dailyDate;app.dailyMediaDate=null;app.currentMonth=app.dailyDate.slice(0,7);render('daily',false);})); $('[data-daily-today]')?.addEventListener('click',()=>{app.dailyDate=new Date().toISOString().slice(0,10);app.dailyMediaDate=null;app.currentMonth=app.dailyDate.slice(0,7);render('daily',false);});
  $$('[data-mood]').forEach(b=>b.addEventListener('click',()=>{$$('[data-mood]').forEach(x=>x.classList.remove('active'));b.classList.add('active');})); $('#dailyPhotos')?.addEventListener('change',uploadDailyPhotos); $$('[data-remove-photo]').forEach(b=>b.addEventListener('click',()=>{app.dailyMediaIds=app.dailyMediaIds.filter(id=>id!==b.dataset.removePhoto); const tile=b.closest('.photo-tile');tile?.remove();})); $('[data-save-daily]')?.addEventListener('click',saveDaily); $('[data-delete-daily]')?.addEventListener('click',()=>confirmAction('Xóa nhật ký ngày này?','Nội dung ngày sẽ bị xóa. Ảnh riêng không còn được tham chiếu có thể xóa sau.',deleteDaily));
  $$('[data-private-id]').forEach(b=>b.addEventListener('click',()=>{app.privateId=b.dataset.privateId;render('private',false);})); $$('[data-new-private]').forEach(b=>b.addEventListener('click',newPrivate)); $('[data-save-private]')?.addEventListener('click',savePrivate); $('[data-delete-private]')?.addEventListener('click',()=>confirmAction('Xóa trang nhật ký?','Không thể hoàn tác từ giao diện.',deletePrivate)); $('#privateBody')?.addEventListener('input',onPrivateInput); $('#privateTitle')?.addEventListener('input',onPrivateInput); $('#privateSearch')?.addEventListener('input',filterPrivateList);
  $$('[data-calendar-date]').forEach(b=>b.addEventListener('click',()=>{app.calendarDate=b.dataset.calendarDate;render('calendar',false);})); $('[data-open-day]')?.addEventListener('click',e=>{app.dailyDate=e.target.dataset.openDay;app.currentMonth=app.dailyDate.slice(0,7);navigate('daily');});
  $$('[data-add-goal]').forEach(b=>b.addEventListener('click',()=>openGoalForm())); $$('[data-edit-goal]').forEach(b=>b.addEventListener('click',()=>openGoalForm(b.dataset.editGoal))); $$('[data-delete-goal]').forEach(b=>b.addEventListener('click',()=>confirmAction('Xóa mục tiêu?','Chỉ mục tiêu bị xóa; giao dịch không bị ảnh hưởng.',()=>deleteGoal(b.dataset.deleteGoal))));
  $$('[data-settings-section]').forEach(b=>b.addEventListener('click',()=>{app.settingsSection=b.dataset.settingsSection;render('settings',false);})); $('[data-edit-profile]')?.addEventListener('click',openProfileForm); $('[data-toggle-privacy]')?.addEventListener('click',()=>saveSetting({privacy:!app.data.settings.privacy})); $('[data-toggle-evening]')?.addEventListener('click',()=>saveSetting({evening:!app.data.settings.evening})); $('[data-auto-lock]')?.addEventListener('click',openAutoLock); $('[data-biometric-toggle]')?.addEventListener('click',toggleBiometric); $('[data-change-password]')?.addEventListener('click',openPasswordForm); $('[data-logout]')?.addEventListener('click',logout); $('[data-export-backup]')?.addEventListener('click',openBackupExport); $('[data-restore-backup]')?.addEventListener('click',openBackupRestore);
}

function shiftMonth(delta){const [y,m]=app.currentMonth.split('-').map(Number),d=new Date(y,m-1+delta,1);app.currentMonth=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;if(app.route==='daily'){app.dailyDate=`${app.currentMonth}-01`;}if(app.route==='calendar'){app.calendarDate=`${app.currentMonth}-01`;}render(app.route,false);}

function accountOptions(selected=''){return accountBalances().map(a=>`<option value="${a.id}" ${a.id===selected?'selected':''}>${esc(a.name)} · ${esc(a.institution)}</option>`).join('');}
function categoryOptions(type,selected=''){const arr=type==='income'?INCOME_CATEGORIES:CATEGORIES;return arr.map(x=>`<option ${x===selected?'selected':''}>${esc(x)}</option>`).join('');}
function openQuick(type='expense'){quickBackdrop.hidden=false;setQuickType(type);$('#quickDate').value=new Date().toISOString().slice(0,10);$('#quickAmount').value='';$('#quickNote').value='';$('#quickAddToMonth').checked=false;bindMoneyInput($('#quickAmount'));}
function closeQuick(){quickBackdrop.hidden=true;}
function setQuickType(type){app.quickType=type;$$('.quick-tab').forEach(b=>b.classList.toggle('active',b.dataset.type===type)); const journal=type==='journal',transfer=type==='transfer',income=type==='income'; $('#quickTitle').textContent=journal?'Mở nhật ký':type==='expense'?'Thêm chi tiêu':income?'Thêm thu nhập':'Chuyển tiền'; $('#amountBlock').hidden=journal; $('#quickMoneyFields').hidden=journal; $('.income-only').hidden=!income; $$('.transfer-only').forEach(x=>x.hidden=!transfer); $('#quickSubmit').textContent=journal?'Đi tới nhật ký':'Lưu giao dịch'; if(!journal){$('#quickCategory').innerHTML=categoryOptions(type);$('#quickCategory').disabled=transfer; if(transfer)$('#quickCategory').innerHTML='<option>Chuyển tiền</option>';$('#quickAccount').innerHTML=accountOptions();$('#quickToAccount').innerHTML=accountOptions();}}
async function submitQuick(e){e.preventDefault();if(app.quickType==='journal'){closeQuick();navigate('daily',{focusDaily:true});return;}const amount=parseMoneyInput($('#quickAmount').value);if(!amount){toast('Nhập số tiền hợp lệ.','error');return;}try{await api('/api/transactions',{method:'POST',json:{type:app.quickType,amount,category:$('#quickCategory').value,accountId:$('#quickAccount').value,toAccountId:$('#quickToAccount').value,date:$('#quickDate').value,note:$('#quickNote').value,addToMonth:$('#quickAddToMonth').checked}});closeQuick();await refreshData();toast('Đã lưu giao dịch.');}catch(err){onError(err);}}

function openForm(title,eyebrow,html){$('#formTitle').textContent=title;$('#formEyebrow').textContent=eyebrow;formBody.innerHTML=html;formBackdrop.hidden=false;bindMoneyInputs(formBody);}
function closeForm(){formBackdrop.hidden=true;formBody.innerHTML='';}
function confirmAction(title,text,onYes){openForm(title,'XÁC NHẬN',`<p class="page-subtitle">${esc(text)}</p><div class="modal-actions"><button class="button-ghost" data-cancel-confirm>Hủy</button><button class="button-danger" data-confirm-action>Xác nhận</button></div>`);$('[data-cancel-confirm]',formBody).onclick=closeForm;$('[data-confirm-action]',formBody).onclick=async()=>{closeForm();try{await onYes();}catch(err){onError(err);}};}

function openMonthPlan(){const s=monthStats();openForm('Tổng tiền tháng','TÀI CHÍNH',`<form id="monthPlanForm" class="form-stack"><p class="page-subtitle">Nhập tổng số tiền bạn muốn dùng cho ${esc(monthLabel().toLowerCase())}. Chi tiêu sẽ tự trừ khỏi số này.</p><label class="field"><span>Tổng tiền tháng</span>${moneyField('monthPlanValue',s.plan||'',{placeholder:'Ví dụ: 10.000.000',required:true})}</label><div class="modal-actions"><button type="button" class="button-ghost" data-cancel>Hủy</button><button class="button-primary">Lưu tổng tiền tháng</button></div></form>`);$('[data-cancel]',formBody).onclick=closeForm;$('#monthPlanForm').onsubmit=async e=>{e.preventDefault();const total=parseMoneyInput($('#monthPlanValue').value);try{await api('/api/month-plan',{method:'PUT',json:{month:app.currentMonth,total}});closeForm();await refreshData();toast('Đã cập nhật tổng tiền tháng.');}catch(err){onError(err);}};}

function openAccountForm(id=null){const a=id?app.data.accounts.find(x=>x.id===id):null;openForm(a?'Sửa tài khoản':'Thêm tài khoản','TÀI KHOẢN & NGÂN HÀNG',`<form id="accountForm" class="form-stack"><label class="field"><span>Tên hiển thị</span><input id="accountName" maxlength="80" value="${esc(a?.name||'')}" placeholder="Ví dụ: Tài khoản lương" required></label><label class="field"><span>Ngân hàng / ví</span><input id="accountInstitution" list="institutionList" value="${esc(a?.institution||'')}" placeholder="Gõ để tìm trong hơn 50 lựa chọn" required></label><label class="field"><span>Số dư ban đầu</span>${moneyField('accountOpening',a?.openingBalance??0,{allowNegative:true})}</label>${a?'<label class="toggle-line"><input id="accountArchived" type="checkbox" '+(a.archived?'checked':'')+'><span><b>Lưu trữ tài khoản</b><small>Ẩn khỏi danh sách chọn mới nhưng giữ lịch sử.</small></span></label>':''}<div class="modal-actions"><button type="button" class="button-ghost" data-cancel>Hủy</button>${a?'<button type="button" class="button-danger" data-delete-account>Xóa</button>':''}<button class="button-primary">${a?'Lưu thay đổi':'Thêm tài khoản'}</button></div></form>`);$('[data-cancel]',formBody).onclick=closeForm;$('#accountForm').onsubmit=async e=>{e.preventDefault();const openingBalance=parseMoneyInput($('#accountOpening').value,{allowNegative:true});try{if(a)await api(`/api/accounts/${a.id}`,{method:'PUT',json:{name:$('#accountName').value,institution:$('#accountInstitution').value,openingBalance,archived:$('#accountArchived').checked}});else await api('/api/accounts',{method:'POST',json:{name:$('#accountName').value,institution:$('#accountInstitution').value,openingBalance}});closeForm();await refreshData();toast('Đã lưu tài khoản.');}catch(err){onError(err);}};if(a)$('[data-delete-account]',formBody).onclick=()=>confirmAction('Xóa tài khoản?','Chỉ xóa được tài khoản chưa có giao dịch.',async()=>{await api(`/api/accounts/${a.id}`,{method:'DELETE'});await refreshData();toast('Đã xóa tài khoản.');});}

function openTxEdit(id){const t=app.data.transactions.find(x=>x.id===id);if(!t)return;openForm('Sửa giao dịch','GIAO DỊCH',`<form id="txEditForm" class="form-stack"><div class="form-grid"><label class="field"><span>Loại</span><select id="txType"><option value="expense" ${t.type==='expense'?'selected':''}>Chi tiêu</option><option value="income" ${t.type==='income'?'selected':''}>Thu nhập</option><option value="transfer" ${t.type==='transfer'?'selected':''}>Chuyển tiền</option></select></label><label class="field"><span>Số tiền</span>${moneyField('txAmount',t.amount,{required:true})}</label></div><div class="form-grid"><label class="field"><span>Danh mục</span><input id="txCategory" value="${esc(t.category)}"></label><label class="field"><span>Ngày</span><input id="txDate" type="date" value="${esc(t.date)}"></label></div><label class="field"><span>Tài khoản</span><select id="txAccount">${accountOptions(t.accountId)}</select></label><label class="field" id="txToWrap" ${t.type==='transfer'?'':'hidden'}><span>Đến tài khoản</span><select id="txToAccount">${accountOptions(t.toAccountId)}</select></label><label class="toggle-line" id="txAddMonthWrap" ${t.type==='income'?'':'hidden'}><input id="txAddMonth" type="checkbox" ${t.addToMonth?'checked':''}><span><b>Cộng vào tiền tháng</b><small>Dùng cho thu nhập phát sinh ngoài tổng tiền tháng ban đầu.</small></span></label><label class="full-field"><span>Ghi chú</span><textarea id="txNote">${esc(t.note||'')}</textarea></label><div class="modal-actions"><button type="button" class="button-ghost" data-cancel>Hủy</button><button class="button-primary">Lưu thay đổi</button></div></form>`);$('#txType').onchange=()=>{$('#txToWrap').hidden=$('#txType').value!=='transfer';$('#txAddMonthWrap').hidden=$('#txType').value!=='income';};$('[data-cancel]',formBody).onclick=closeForm;$('#txEditForm').onsubmit=async e=>{e.preventDefault();try{await api(`/api/transactions/${id}`,{method:'PUT',json:{type:$('#txType').value,amount:parseMoneyInput($('#txAmount').value),category:$('#txCategory').value,accountId:$('#txAccount').value,toAccountId:$('#txToAccount').value,date:$('#txDate').value,note:$('#txNote').value,addToMonth:$('#txAddMonth').checked}});closeForm();await refreshData();toast('Đã cập nhật giao dịch.');}catch(err){onError(err);}};}
async function deleteTx(id){await api(`/api/transactions/${id}`,{method:'DELETE'});await refreshData();toast('Đã xóa giao dịch.');}

function openBudgetForm(id=null){const b=id?app.data.budgets.find(x=>x.id===id):null;openForm(b?'Sửa ngân sách':'Thêm ngân sách','NGÂN SÁCH',`<form id="budgetForm" class="form-stack"><label class="field"><span>Danh mục</span><select id="budgetCategory">${CATEGORIES.map(c=>`<option ${c===b?.category?'selected':''}>${esc(c)}</option>`).join('')}</select></label><label class="field"><span>Tháng</span><input value="${esc(monthLabel(b?.month||app.currentMonth))}" disabled><input type="hidden" id="budgetMonth" value="${esc(b?.month||app.currentMonth)}"></label><label class="field"><span>Giới hạn chi</span>${moneyField('budgetLimit',b?.limit||'',{placeholder:'Ví dụ: 3.000.000',required:true})}</label><div class="modal-actions"><button type="button" class="button-ghost" data-cancel>Hủy</button><button class="button-primary">Lưu ngân sách</button></div></form>`);$('[data-cancel]',formBody).onclick=closeForm;$('#budgetForm').onsubmit=async e=>{e.preventDefault();const payload={month:$('#budgetMonth').value,category:$('#budgetCategory').value,limit:parseMoneyInput($('#budgetLimit').value)};try{if(b)await api(`/api/budgets/${b.id}`,{method:'PUT',json:payload});else await api('/api/budgets',{method:'POST',json:payload});closeForm();await refreshData();toast('Đã lưu ngân sách.');}catch(err){onError(err);}};}
async function deleteBudget(id){await api(`/api/budgets/${id}`,{method:'DELETE'});await refreshData();toast('Đã xóa ngân sách.');}

async function uploadDailyPhotos(e){const files=[...e.target.files];if(!files.length)return;const status=$('#uploadStatus');let done=0;for(const file of files){try{status.textContent=`Đang tải ${done+1}/${files.length}: ${file.name}`;const res=await fetch('/api/media',{method:'POST',headers:{'x-csrf-token':app.csrf,'x-file-name':encodeURIComponent(file.name),'content-type':file.type},body:file,credentials:'same-origin'});const j=await res.json();if(!res.ok)throw new Error(j.error||'Không tải được ảnh.');app.dailyMediaIds.push(j.data.id);app.data.media.push(j.data);done++;}catch(err){onError(err);}}status.textContent=`Đã tải ${done}/${files.length} ảnh. Bấm “Lưu nhật ký” để gắn vào ngày này.`;render('daily',false);}
async function saveDaily(){const mood=$('[data-mood].active')?.dataset.mood||'';try{await api('/api/daily',{method:'PUT',json:{date:app.dailyDate,title:$('#dailyTitle').value,body:$('#dailyBody').value,mood,mediaIds:app.dailyMediaIds}});await refreshData();toast('Đã lưu nhật ký.');}catch(err){onError(err);}}
async function deleteDaily(){await api(`/api/daily/${encodeURIComponent(app.dailyDate)}`,{method:'DELETE'});await refreshData();toast('Đã xóa nhật ký ngày này.');}

async function newPrivate(){try{const r=await api('/api/private',{method:'POST',json:{title:'Trang chưa đặt tên',body:''}});app.privateId=r.data.id;await refreshData();toast('Đã tạo trang mới.');}catch(err){onError(err);}}
function onPrivateInput(){if(!app.privateId)return;$('#privateCount').textContent=`${countWords($('#privateBody').value)} từ`;$('#privateSaveState').textContent='Đang chờ lưu...';clearTimeout(app.privateSaveTimer);app.privateSaveTimer=setTimeout(()=>savePrivate(true),900);}
async function savePrivate(silent=false){if(!app.privateId)return;const titleEl=$('#privateTitle'),bodyEl=$('#privateBody');if(!titleEl||!bodyEl)return;try{await api(`/api/private/${app.privateId}`,{method:'PUT',json:{title:titleEl.value,body:bodyEl.value}});if(!silent){await refreshData();toast('Đã lưu trang nhật ký.');}else{$('#privateSaveState')&&($('#privateSaveState').textContent='Đã tự lưu');const e=app.data.privateEntries.find(x=>x.id===app.privateId);if(e){e.title=titleEl.value;e.body=bodyEl.value;e.updatedAt=new Date().toISOString();}}}catch(err){if(!silent)onError(err);}}
async function deletePrivate(){await api(`/api/private/${app.privateId}`,{method:'DELETE'});app.privateId=null;await refreshData();toast('Đã xóa trang.');}
function filterPrivateList(e){const q=e.target.value.toLowerCase();$$('.private-entry-button').forEach(b=>{const entry=app.data.privateEntries.find(x=>x.id===b.dataset.privateId);b.hidden=!`${entry?.title||''} ${entry?.body||''}`.toLowerCase().includes(q);});}

function openGoalForm(id=null){const g=id?app.data.goals.find(x=>x.id===id):null;openForm(g?'Cập nhật mục tiêu':'Thêm mục tiêu','MỤC TIÊU',`<form id="goalForm" class="form-stack"><label class="field"><span>Tên mục tiêu</span><input id="goalName" maxlength="120" value="${esc(g?.name||'')}" required></label><div class="form-grid"><label class="field"><span>Số tiền mục tiêu</span>${moneyField('goalTarget',g?.target||'',{placeholder:'Ví dụ: 5.000.000',required:true})}</label><label class="field"><span>Đã có</span>${moneyField('goalCurrent',g?.current||0)}</label></div><label class="field"><span>Ngày dự kiến (tùy chọn)</span><input id="goalDeadline" type="date" value="${esc(g?.deadline||'')}"></label><label class="full-field"><span>Ghi chú</span><textarea id="goalNote">${esc(g?.note||'')}</textarea></label><div class="modal-actions"><button type="button" class="button-ghost" data-cancel>Hủy</button><button class="button-primary">Lưu mục tiêu</button></div></form>`);$('[data-cancel]',formBody).onclick=closeForm;$('#goalForm').onsubmit=async e=>{e.preventDefault();const payload={name:$('#goalName').value,target:parseMoneyInput($('#goalTarget').value),current:parseMoneyInput($('#goalCurrent').value),deadline:$('#goalDeadline').value,note:$('#goalNote').value};try{if(g)await api(`/api/goals/${g.id}`,{method:'PUT',json:payload});else await api('/api/goals',{method:'POST',json:payload});closeForm();await refreshData();toast('Đã lưu mục tiêu.');}catch(err){onError(err);}};}
async function deleteGoal(id){await api(`/api/goals/${id}`,{method:'DELETE'});await refreshData();toast('Đã xóa mục tiêu.');}

function openProfileForm(){openForm('Tên hiển thị','TÀI KHOẢN',`<form id="profileForm" class="form-stack"><label class="field"><span>Tên hiển thị</span><input id="profileValue" maxlength="60" value="${esc(app.data.settings.displayName)}"></label><div class="modal-actions"><button type="button" class="button-ghost" data-cancel>Hủy</button><button class="button-primary">Lưu</button></div></form>`);$('[data-cancel]',formBody).onclick=closeForm;$('#profileForm').onsubmit=async e=>{e.preventDefault();try{await saveSetting({displayName:$('#profileValue').value});closeForm();toast('Đã đổi tên hiển thị.');}catch(err){onError(err);}};}
function openAutoLock(){openForm('Tự khóa','BẢO MẬT',`<form id="autoLockForm" class="form-stack"><label class="field"><span>Khóa sau khi không hoạt động</span><select id="autoLockValue">${[5,10,15,30,60,120].map(n=>`<option value="${n}" ${n===app.data.settings.autoLockMinutes?'selected':''}>${n} phút</option>`).join('')}</select></label><div class="modal-actions"><button type="button" class="button-ghost" data-cancel>Hủy</button><button class="button-primary">Lưu</button></div></form>`);$('[data-cancel]',formBody).onclick=closeForm;$('#autoLockForm').onsubmit=async e=>{e.preventDefault();await saveSetting({autoLockMinutes:Number($('#autoLockValue').value)});closeForm();toast('Đã cập nhật thời gian tự khóa.');};}
function openPasswordForm(){openForm('Đổi mật khẩu','BẢO MẬT',`<form id="passwordForm" class="form-stack"><label class="field"><span>Mật khẩu hiện tại</span><input id="pwCurrent" type="password" autocomplete="current-password" required></label><label class="field"><span>Mật khẩu mới</span><input id="pwNext" type="password" minlength="10" autocomplete="new-password" required></label><label class="field"><span>Nhập lại mật khẩu mới</span><input id="pwConfirm" type="password" minlength="10" autocomplete="new-password" required></label><div class="modal-actions"><button type="button" class="button-ghost" data-cancel>Hủy</button><button class="button-primary">Đổi mật khẩu</button></div></form>`);$('[data-cancel]',formBody).onclick=closeForm;$('#passwordForm').onsubmit=async e=>{e.preventDefault();if($('#pwNext').value!==$('#pwConfirm').value){toast('Hai mật khẩu mới không khớp.','error');return;}try{await api('/api/password',{method:'POST',json:{current:$('#pwCurrent').value,next:$('#pwNext').value}});closeForm();toast('Đã đổi mật khẩu.');}catch(err){onError(err);}};}
function openBackupExport(){openForm('Xuất bản sao mã hóa','SAO LƯU',`<form id="backupExportForm" class="form-stack"><p class="page-subtitle">Bản sao bao gồm dữ liệu và toàn bộ ảnh. Đặt mật khẩu riêng cho file này; iOS sẽ mở Share Sheet sau khi mã hóa xong.</p><label class="field"><span>Mật khẩu bản sao</span><input id="backupPassword" type="password" minlength="8" required></label><div class="modal-actions"><button type="button" class="button-ghost" data-cancel>Hủy</button><button class="button-primary">Tạo bản sao</button></div></form>`);$('[data-cancel]',formBody).onclick=closeForm;$('#backupExportForm').onsubmit=async e=>{e.preventDefault();try{await LocalAPI.exportBackup($('#backupPassword').value);closeForm();toast('Đã tạo bản sao mã hóa. Chọn nơi lưu trong Share Sheet.');}catch(err){onError(err);}};}
function openBackupRestore(){openForm('Khôi phục bản sao','SAO LƯU',`<form id="restoreForm" class="form-stack"><p class="page-subtitle">Nhập mật khẩu bản sao, sau đó chọn file .sobackup từ Files. Dữ liệu hiện tại chỉ bị thay sau khi bản sao được giải mã và kiểm tra toàn vẹn thành công.</p><label class="field"><span>Mật khẩu bản sao</span><input id="restorePassword" type="password" minlength="8" required></label><div class="modal-actions"><button type="button" class="button-ghost" data-cancel>Hủy</button><button class="button-danger">Chọn file & khôi phục</button></div></form>`);$('[data-cancel]',formBody).onclick=closeForm;$('#restoreForm').onsubmit=async e=>{e.preventDefault();try{await LocalAPI.restoreBackup($('#restorePassword').value);closeForm();await refreshData();toast('Đã khôi phục bản sao.');}catch(err){if(!/hủy chọn/i.test(err.message||''))onError(err);}};}
async function toggleBiometric(){try{const next=!app.nativeStatus?.biometricEnabled;app.nativeStatus=await LocalAPI.setBiometric(next);updateBiometricLogin();render('settings',false);toast(next?'Đã bật mở khóa sinh trắc học.':'Đã tắt mở khóa sinh trắc học.');}catch(err){onError(err);}}


function openCommand(){commandBackdrop.hidden=false;$('#commandInput').value='';renderCommandResults();setTimeout(()=>$('#commandInput').focus(),20);}function closeCommand(){commandBackdrop.hidden=true;}
function renderCommandResults(){const q=$('#commandInput').value.trim().toLowerCase();let items=[];for(const t of app.data?.transactions||[])items.push({route:'transactions',icon:'↕',title:txTitle(t),sub:`${t.category} · ${shortDate(t.date)}`});for(const e of app.data?.dailyEntries||[])items.push({route:'daily',date:e.date,icon:'☼',title:e.title||'Nhật ký hằng ngày',sub:`${shortDate(e.date)} · ${e.mood||'Không mood'}`});for(const e of app.data?.privateEntries||[])items.push({route:'private',privateId:e.id,icon:'✎',title:e.title,sub:'Nhật ký cá nhân'});for(const g of app.data?.goals||[])items.push({route:'goals',icon:'◇',title:g.name,sub:`${money(g.current)} / ${money(g.target)}`});if(q)items=items.filter(x=>`${x.title} ${x.sub}`.toLowerCase().includes(q));items=items.slice(0,14);$('#commandResults').innerHTML=items.length?items.map((x,i)=>`<button class="command-item" data-command-index="${i}"><span class="command-item-icon">${x.icon}</span><span class="command-item-copy"><b>${esc(x.title)}</b><small>${esc(x.sub)}</small></span></button>`).join(''):'<div class="empty-state"><strong>Không tìm thấy kết quả.</strong></div>';$$('[data-command-index]').forEach(b=>b.onclick=()=>{const x=items[Number(b.dataset.commandIndex)];if(x.date){app.dailyDate=x.date;app.currentMonth=x.date.slice(0,7);}if(x.privateId)app.privateId=x.privateId;closeCommand();navigate(x.route);});}

async function logout(){try{await api('/api/logout',{method:'POST',json:{}});}catch{}app.data=null;app.csrf=null;app.nativeStatus=await LocalAPI.status().catch(()=>({}));appShell.hidden=true;$('#mobileNav').hidden=true;authScreen.hidden=false;loginForm.hidden=false;setupForm.hidden=true;updateBiometricLogin();}
function resetActivity(){app.lastActivity=Date.now();}function checkAutoLock(){if(!app.data)return;const mins=Number(app.data.settings.autoLockMinutes||15);if(Date.now()-app.lastActivity>mins*60000)logout();}

window.addEventListener('sorelax-resume',()=>{checkAutoLock();resetActivity();});document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkAutoLock();});
bindGlobal(); boot();
