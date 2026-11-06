
/* =========================================================
   الدحيح — منصة تنظيم المذاكرة | الوضع التجريبي 
   ========================================================= */
'use strict';
const LS_PREFIX  = 'eldaheeh_db_v2_';   // بيانات كل مستخدم في مفتاح منفصل
const LS_LEGACY  = 'eldaheeh_db_v1';    // النسخة القديمة (بيانات مشتركة) — بنرحّلها تلقائيًا
const LS_SESSION = 'eldaheeh_session';
const LS_AUTH    = 'eldaheeh_auth';
const LS_THEME   = 'eldaheeh_theme';
const DEMO_EMAIL = 'demo@eldaheeh.app';
const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
// تاريخ محلي بصيغة YYYY-MM-DD (من غير toISOString عشان ما يتحولش لـ UTC ويتزحزح يوم)
const isoDate = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const todayISO = () => isoDate(new Date());
// تطبيع النص العربي للبحث (تشكيل، تطويل، همزات)
const normAr = s => String(s??'').toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه');
const esc = s => String(s??'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- التخزين (آمن ضد التعطيل/الامتلاء) ---------- */
const emptyData = () => ({ subjects:[], tasks:[], sessions:[], events:[], settings:{ studyHours:2 } });
let DB = { user:null, ...emptyData() };
let storageWarned = false;
function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k,v){
  try{ localStorage.setItem(k,v); return true; }
  catch(e){
    if(!storageWarned){ storageWarned=true; setTimeout(()=>toast('تعذّر حفظ بياناتك في المتصفح (التخزين معطّل أو ممتلئ). صدّر نسخة احتياطية من الإعدادات.','error'),0); }
    return false;
  }
}
function lsDel(k){ try{ localStorage.removeItem(k); }catch(e){} }
function readJSON(k,fallback){ try{ const raw=lsGet(k); return raw? JSON.parse(raw) : fallback; }catch(e){ return fallback; } }
const userKey = email => LS_PREFIX + String(email||'').trim().toLowerCase();

function loadUserData(){
  const d = readJSON(userKey(DB.user.email), null);
  DB = { ...emptyData(), ...(d||{}), user:DB.user };
  DB.settings = { studyHours:2, ...(DB.settings||{}) };
}
function loadDB(){
  DB = { user:null, ...emptyData() };
  // ترحيل النسخة القديمة اللي كانت بتشارك بيانات كل الحسابات في مفتاح واحد
  const legacy = readJSON(LS_LEGACY, null);
  if(legacy && legacy.user && legacy.user.email){
    const { user, ...data } = legacy;
    if(!lsGet(userKey(user.email))) lsSet(userKey(user.email), JSON.stringify(data));
    if(!lsGet(LS_SESSION)) lsSet(LS_SESSION, JSON.stringify(user));
  }
  if(legacy) lsDel(LS_LEGACY);
  const u = readJSON(LS_SESSION, null);
  if(u && u.email){ DB.user = u; loadUserData(); }
}
function saveDB(){
  if(!DB.user) return;
  const { user, ...data } = DB;
  lsSet(userKey(user.email), JSON.stringify(data));
  lsSet(LS_SESSION, JSON.stringify(user));
}
function startSession(user){
  DB = { user, ...emptyData() };
  loadUserData();
  saveDB();
}

/* ---------- الحسابات: كلمات المرور مُشفّرة (hash + salt) ---------- */
// ملحوظة: ده وضع تجريبي بدون خادم؛ التشفير هنا بيمنع تخزين الباسورد نصًا، لكنه مش بديل عن حساب حقيقي بقاعدة بيانات.
const getAuth = () => { const a=readJSON(LS_AUTH,[]); return Array.isArray(a)?a:[]; };
const setAuth = list => lsSet(LS_AUTH, JSON.stringify(list));
const sameEmail = (a,b) => String(a||'').trim().toLowerCase() === String(b||'').trim().toLowerCase();
function cyrb53(str,seed=0){
  let h1=0xdeadbeef^seed, h2=0x41c6ce57^seed;
  for(let i=0,ch;i<str.length;i++){ ch=str.charCodeAt(i); h1=Math.imul(h1^ch,2654435761); h2=Math.imul(h2^ch,1597334677); }
  h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);
  h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);
  return (4294967296*(2097151&h2)+(h1>>>0)).toString(16);
}
const hasSubtle = () => !!(window.crypto && crypto.subtle);
async function hashPass(pass,salt,algo){
  const text = salt+':'+pass;
  algo = algo || (hasSubtle() ? 's256' : 'c53');
  if(algo==='s256'){
    if(!hasSubtle()) throw new Error('crypto.subtle غير متاح');
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return 's256:'+[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  return 'c53:'+cyrb53(text);
}
function newSalt(){
  const a=new Uint8Array(12);
  if(window.crypto && crypto.getRandomValues) crypto.getRandomValues(a); else a.forEach((_,i)=>a[i]=Math.floor(Math.random()*256));
  return [...a].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function verifyPass(acc,pass){
  if(acc.hash){ return (await hashPass(pass, acc.salt||'', acc.hash.split(':')[0])) === acc.hash; }
  return acc.pass === pass; // حساب قديم بكلمة مرور نصية — هيتم ترقيته بعد أول دخول ناجح
}

/* ---------- الوضع الليلي ---------- */
const getTheme = () => lsGet(LS_THEME) || ((window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
const applyTheme = t => { document.documentElement.dataset.theme = t==='dark' ? 'dark' : 'light'; };
function toggleTheme(){ const n=getTheme()==='dark'?'light':'dark'; lsSet(LS_THEME,n); applyTheme(n); updateHeader(); }

const AR_DAYS=['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const WEEK_ORDER=[6,0,1,2,3,4,5]; // الأسبوع بيبدأ السبت: ترتيب أعمدة الجدول والتقويم
const AR_MONTHS=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
function fmtDate(iso){ if(!iso) return ''; const d=new Date(iso+'T00:00:00'); return `${AR_DAYS[d.getDay()]} ${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
function fmtShort(iso){ if(!iso) return ''; const d=new Date(iso+'T00:00:00'); return `${d.getDate()} ${AR_MONTHS[d.getMonth()]}`; }
function isOverdue(t){ return t.status!=='done' && t.due && t.due < todayISO(); }
// إنهاء/إعادة فتح مهمة مع تذكّر حالتها السابقة (قيد التنفيذ ما تتحولش لـ «لم تبدأ»)
function setTaskDone(x,checked){
  if(checked){ if(x.status!=='done') x.prevStatus=x.status; x.status='done'; }
  else x.status = (x.prevStatus && x.prevStatus!=='done') ? x.prevStatus : 'todo';
}

/* ---------- toast & confirm ---------- */
function toast(msg,type='success'){
  const w=$('.toast-wrap'); const el=document.createElement('div');
  el.className='toast '+type; el.textContent=msg; w.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transition='.3s'; setTimeout(()=>el.remove(),300); },2800);
}
function confirmDialog(msg, cb){
  openModal('تأكيد', `<p style="line-height:1.9">${esc(msg)}</p>`, ()=>{ cb(); return true; }, {okText:'نعم، متابعة', danger:true});
}

/* ---------- modal ---------- */
function openModal(title, bodyHTML, onSubmit, opts={}){
  const prevFocus=document.activeElement;
  const tid='mt'+uid();
  const ov=document.createElement('div'); ov.className='modal-overlay';
  ov.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="${tid}"><h3 id="${tid}">${esc(title)}</h3><form id="modalForm" novalidate>${bodyHTML}
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" data-close>إلغاء</button>
      <button type="submit" class="btn ${opts.danger?'btn-danger':'btn-primary'}">${esc(opts.okText||'حفظ')}</button>
    </div></form></div>`;
  document.body.appendChild(ov);
  // لما النافذة تتقفل نرجّع التركيز للعنصر اللي فتحها
  const nativeRemove=ov.remove.bind(ov);
  ov.remove=()=>{ nativeRemove(); if(prevFocus && document.contains(prevFocus) && prevFocus.focus) prevFocus.focus(); };
  ov.addEventListener('click',e=>{ if(e.target===ov) ov.remove(); });
  ov.querySelector('[data-close]').onclick=()=>ov.remove();
  ov.querySelector('#modalForm').addEventListener('submit',e=>{
    e.preventDefault();
    const res=onSubmit(ov);
    if(res!==false) ov.remove();
  });
  const first=ov.querySelector('input,select,textarea') || ov.querySelector('button[type="submit"]'); if(first) first.focus();
  return ov;
}
// Esc لإغلاق النافذة + حبس التركيز (Tab) جواها
document.addEventListener('keydown',e=>{
  const ovs=document.querySelectorAll('.modal-overlay'); if(!ovs.length) return;
  const ov=ovs[ovs.length-1];
  if(e.key==='Escape'){ e.preventDefault(); ov.remove(); return; }
  if(e.key!=='Tab') return;
  const f=[...ov.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')].filter(x=>x.offsetParent!==null);
  if(!f.length) return;
  const a=document.activeElement, firstEl=f[0], lastEl=f[f.length-1];
  if(!ov.contains(a)){ e.preventDefault(); firstEl.focus(); }
  else if(e.shiftKey && a===firstEl){ e.preventDefault(); lastEl.focus(); }
  else if(!e.shiftKey && a===lastEl){ e.preventDefault(); firstEl.focus(); }
});

/* ---------- lookup helpers ---------- */
const subjectById = id => DB.subjects.find(s=>s.id===id);
const subjectName = id => { const s=subjectById(id); return s? s.name : 'بدون مادة'; };
const subjectColor = id => { const s=subjectById(id); return s? s.color : '#64748b'; };
const subjectOptions = sel => DB.subjects.map(s=>`<option value="${s.id}" ${s.id===sel?'selected':''}>${esc(s.name)}</option>`).join('');

/* =========================================================
   Router
   ========================================================= */
const PUBLIC_ROUTES=['#/home','#/login','#/register','#/forgot'];
function go(h){ if(location.hash===h) render(); else location.hash=h; }
function render(){
  const h=location.hash||'#/home';
  const app=$('#view');
  if(DB.user && PUBLIC_ROUTES.includes(h)) return go('#/dashboard');
  if(!DB.user && !PUBLIC_ROUTES.includes(h)){ go('#/login'); return; }
  document.body.classList.toggle('in-app', !!DB.user);
  const V={ '#/home':viewHome,'#/login':viewLogin,'#/register':viewRegister,'#/forgot':viewForgot,
    '#/dashboard':viewDashboard,'#/subjects':viewSubjects,'#/schedule':viewSchedule,
    '#/tasks':viewTasks,'#/calendar':viewCalendar,'#/settings':viewSettings };
  (V[h]||viewHome)(app);
  updateHeader();
  updateSidebar(h);
  window.scrollTo(0,0);
}
function updateSidebar(h){
  const sb=$('#sidebar'); if(!sb) return;
  sb.querySelectorAll('.side-link').forEach(a=>a.classList.toggle('active', a.getAttribute('href')===h));
}
const ICO={
 home:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
 book:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-2.5"/></svg>',
 cal:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
 clock:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
 check:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M9 11l3 3 8-8"/><path d="M21 12v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11"/></svg>',
 gear:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z"/></svg>',
 logout:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>',
 spark:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/></svg>'
};
const LOGO = `<svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
 <path d="M32 46c-5-4-12-5-18-4V20c6-1 13 0 18 4 5-4 12-5 18-4v22c-6-1-13 0-18 4z" fill="#0d9488" opacity=".15"/>
 <path d="M32 46c-5-4-12-5-18-4V20c6-1 13 0 18 4 5-4 12-5 18-4v22c-6-1-13 0-18 4z" stroke="#0f766e" stroke-width="2.5" stroke-linejoin="round"/>
 <path d="M32 24v22" stroke="#0f766e" stroke-width="2.5"/>
 <path d="M39 8a7 7 0 0 1 7 7c0 2-1 3.4-2.2 4.6L43 22h-8l-.8-2.4A7 7 0 0 1 39 8z" fill="#fbbf24" stroke="#d97706" stroke-width="1.6"/>
 <path d="M39 22v6" stroke="#d97706" stroke-width="2" stroke-linecap="round"/>
 <path d="m36 28 3 3 3-3" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

function updateHeader(){
  const hd=$('#siteHeader .header-actions'); if(!hd) return;
  const themeBtn=`<button class="btn btn-ghost btn-sm" id="hdrTheme" aria-label="تبديل الوضع الليلي" title="تبديل الوضع الليلي">${getTheme()==='dark'?'☀️':'🌙'}</button>`;
  hd.innerHTML = themeBtn + (DB.user
    ? `<span style="font-weight:700;color:var(--muted);font-size:.9rem">أهلاً، ${esc(DB.user.name)}</span>
       <a class="btn btn-primary btn-sm" href="#/dashboard">لوحة التحكم</a>
       <button class="btn btn-ghost btn-sm" id="hdrLogout">تسجيل الخروج</button>`
    : `<a class="btn btn-ghost btn-sm" href="#/login">تسجيل الدخول</a>
       <a class="btn btn-primary btn-sm" href="#/register">إنشاء حساب</a>`);
  const lo=$('#hdrLogout'); if(lo) lo.onclick=doLogout;
  const tb=$('#hdrTheme'); if(tb) tb.onclick=toggleTheme;
}
function doLogout(){ confirmDialog('متأكد إنك عايز تسجّل خروجك من الدحيح؟', ()=>{ lsDel(LS_SESSION); DB={ user:null, ...emptyData() }; toast('تم تسجيل الخروج. إلى اللقاء!'); go('#/home'); }); }

/* =========================================================
   Views — public pages
   ========================================================= */
function viewHome(app){
  app.innerHTML = `
  <section class="hero">
    <div>
      <h1>ذاكر بذكاء، ونظّم يومك مع الدحيح</h1>
      <p>الدحيح هو مساعدك الدراسي لتنظيم المواد والمواعيد والواجبات وجلسات المذاكرة، عشان تقدر تتابع تقدمك وتذاكر بطريقة أكثر تنظيمًا.</p>
      <div class="hero-btns">
        <a class="btn btn-primary" href="#/register">ابدأ تنظيم مذاكرتك</a>
        <a class="btn btn-ghost" href="#/home" data-scroll="features">اكتشف المميزات</a>
      </div>
    </div>
    <div class="hero-art">
      <div class="panel" style="margin:0">
        <h3>لوحة تحكمك في لمحة 👀</h3>
        <div class="list-row"><span>📚</span><span class="grow">محاضرة رياضيات — 10 صباحًا</span><span class="tag tag-doing">قيد التنفيذ</span></div>
        <div class="list-row"><span>✅</span><span class="grow">واجب الفيزياء</span><span class="tag tag-done">مكتملة</span></div>
        <div class="list-row"><span>🧠</span><span class="grow">جلسة مراجعة — 45 دقيقة</span><span class="tag tag-med">اليوم</span></div>
        <div class="progressbar" style="margin-top:14px"><div style="width:70%"></div></div>
        <p style="font-size:.8rem;margin:6px 0 0;color:var(--muted)">نسبة إنجاز الأسبوع: 70%</p>
      </div>
    </div>
  </section>

  <section class="section" id="features">
    <h2>مميزات الدحيح</h2>
    <p class="lead">كل اللي محتاجه الطالب عشان يذاكر بتركيز، في مكان واحد وبسيط.</p>
    <div class="grid3">
      <div class="card"><div class="icon-badge">${ICO.book}</div><h3>إدارة المواد الدراسية</h3><p>أضف موادك، لون كل مادة، بيانات المدرس أو الدكتور، وجدول المحاضرات، كل حاجة في مكان واحد.</p></div>
      <div class="card"><div class="icon-badge">${ICO.clock}</div><h3>جدول مذاكرة أسبوعي</h3><p>خطط لجلسات مذاكرتك باليوم والساعة، وتابع اللي خلصته واللي لسه.</p></div>
      <div class="card"><div class="icon-badge">${ICO.check}</div><h3>مهام وواجبات مرتبة</h3><p>سجل واجباتك بموعد التسليم والأولوية، والدحيح يفكرك بالمتأخر منها.</p></div>
      <div class="card"><div class="icon-badge">${ICO.cal}</div><h3>تقويم دراسي موحّد</h3><p>شوف الواجبات والامتحانات وجلسات المذاكرة كلها على تقويم واحد ملوّن.</p></div>
      <div class="card"><div class="icon-badge">${ICO.spark}</div><h3>متابعة تقدمك</h3><p>نسبة الإنجاز وإحصائياتك تتحسب من بياناتك الحقيقية، مش أرقام جاهزة.</p></div>
      <div class="card"><div class="icon-badge">${ICO.home}</div><h3>يعمل على أي جهاز</h3><p>تصميم متجاوب يشتغل ممتاز على الموبايل والكمبيوتر والتابلت.</p></div>
    </div>
  </section>

  <section class="section">
    <h2>إزاي تستخدم الدحيح؟</h2>
    <p class="lead">ثلاث خطوات بس وتبدأ رحلة تنظيم مذاكرتك.</p>
    <div class="grid3">
      <div class="card" style="text-align:center"><div style="font-size:2.2rem;font-weight:800;color:var(--primary)">١</div><h3>أنشئ حسابك</h3><p>سجّل في ثواني وابدأ استخدم المنصة فورًا في الوضع التجريبي.</p></div>
      <div class="card" style="text-align:center"><div style="font-size:2.2rem;font-weight:800;color:var(--primary)">٢</div><h3>أضف موادك ومهامك</h3><p>سجل المواد الدراسية والواجبات ومواعيد الامتحانات وجلسات المذاكرة.</p></div>
      <div class="card" style="text-align:center"><div style="font-size:2.2rem;font-weight:800;color:var(--primary)">٣</div><h3>ذاكر بنظام</h3><p>تابع جدولك اليومي ونسبة تقدمك، وقلل التشتت وذاكر بتركيز.</p></div>
    </div>
  </section>

  <section class="section">
    <h2>الدحيح مصمم لمين؟</h2>
    <p class="lead">لأي طالب عايز ينظم وقته ومذاكرته، بغض النظر عن مستواه التقني.</p>
    <div class="grid4">
      <div class="card"><h3>🎓 طلاب الجامعات</h3><p>تابع مواد السمنستر والمحاضرات والواجبات والكويزات.</p></div>
      <div class="card"><h3>🔧 طلاب المعاهد الفنية</h3><p>نظم موادك العملية والنظرية في جدول واحد.</p></div>
      <div class="card"><h3>📖 طلاب الثانوية العامة</h3><p>خطط لمذاكرة المواد الأساسية وتابع تقدمك يوم بيوم.</p></div>
      <div class="card"><h3>⏰ اللي بيتشتت</h3><p>واجهة بسيطة ورسائل واضحة تخليك تركز على المذاكرة بس.</p></div>
    </div>
  </section>

  <section class="section">
    <h2>الأسئلة الشائعة</h2>
    <div style="max-width:760px;margin:auto">
      ${[['هل استخدام الدحيح مجاني؟','النسخة الحالية مجانية بالكامل وتعمل في وضع تجريبي بالتخزين المحلي.'],
         ['هل بياناتي آمنة؟','حاليًا بياناتك تُحفظ في متصفحك فقط (وضع تجريبي) — مناسب للتجربة. جاري العمل على قاعدة بيانات حقيقية لتخزين آمن في السحابة.'],
         ['هل الدحيح يشتغل على الموبايل؟','أيوه، الموقع متجاوب بالكامل ويشتغل على الموبايل والكمبيوتر والتابلت.'],
         ['إيه اللي يحصل لو مسحت بيانات المتصفح؟','بما إنها نسخة تجريبية، مسح بيانات الموقع من المتصفح هيحذف بياناتك — فخد نسخة احتياطية من أهم المعلومات لحد ما نفعّل التخزين السحابي.'],
         ['هل فيه اشتراكات مدفوعة؟','لأ، النسخة الأولى مجانية بالكامل ومركزة على الوظائف الأساسية للتنظيم الدراسي.']]
        .map((f,i)=>`<div class="faq-item" id="faq${i}"><button class="faq-q" data-faq="${i}" aria-expanded="false"><span>${f[0]}</span><span>＋</span></button><div class="faq-a">${f[1]}</div></div>`).join('')}
    </div>
  </section>`;
  app.querySelectorAll('.faq-q').forEach(b=>b.onclick=()=>{
    const it=b.closest('.faq-item'); const open=it.classList.toggle('open');
    b.setAttribute('aria-expanded', open?'true':'false');
    b.querySelector('span:last-child').textContent = open?'−':'＋';
  });
  // الرابط ده كان href="#features" وبيكسر الراوتر ويودّي لصفحة الدخول
  app.querySelectorAll('[data-scroll]').forEach(a=>a.onclick=e=>{
    e.preventDefault(); document.getElementById(a.dataset.scroll)?.scrollIntoView({behavior:'smooth'});
  });
}

/* ---------- auth ---------- */
function fieldHTML(id,label,type='text',opts={}){
  // بعض الاستدعاءات بتمرر الـ opts مكان الـ type (كانت بتضيّع الـ placeholder ورسالة الخطأ)
  if(type && typeof type==='object'){ opts=type; type='text'; }
  return `<div class="field" id="fw-${id}"><label for="${id}">${label}</label>
    <input id="${id}" type="${type}" ${opts.attrs||''} placeholder="${opts.ph||''}">
    <div class="err">${opts.err||'هذا الحقل مطلوب'}</div></div>`;
}
function setInvalid(id,bad,msg){ const fw=$('#fw-'+id); fw.classList.toggle('invalid',bad); if(bad&&msg) fw.querySelector('.err').textContent=msg; return !bad; }

function viewLogin(app){
  app.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <div style="text-align:center;margin-bottom:8px">${LOGO.replace('width="40"','')}</div>
    <h2>أهلًا بيك في الدحيح!</h2>
    <p class="sub">سجّل دخولك وكمّل تنظيم مذاكرتك</p>
    <div class="demo-note">⚠️ <strong>وضع تجريبي:</strong> لا يوجد خادم أو قاعدة بيانات حقيقية بعد. بياناتك تُحفظ في متصفحك فقط، وإنشاء الحساب هنا لا يؤهل كحساب آمن فعلي.</div>
    <form id="loginForm" novalidate>
      ${fieldHTML('email','البريد الإلكتروني','email',{ph:'name@example.com',err:'أدخل بريدًا إلكترونيًا صحيحًا'})}
      ${fieldHTML('pass','كلمة المرور','password',{ph:'••••••••',err:'كلمة المرور مطلوبة'})}
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:6px">تسجيل الدخول</button>
    </form>
    <div style="display:flex;justify-content:space-between;margin-top:14px;font-size:.88rem;flex-wrap:wrap;gap:8px">
      <a href="#/forgot">نسيت كلمة المرور؟</a>
      <a href="#/register">مش عندك حساب؟ أنشئ حسابًا</a>
    </div>
    <hr style="border:none;border-top:1px dashed #d7e8e4;margin:18px 0">
    <button class="btn btn-ghost btn-block" id="demoBtn">الدخول السريع في الوضع التجريبي</button>
  </div></div>`;
  $('#loginForm').onsubmit=async e=>{
    e.preventDefault();
    const em=$('#email').value.trim().toLowerCase(), pw=$('#pass').value;
    const okE=setInvalid('email', !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em));
    const okP=setInvalid('pass', !pw);
    if(!okE||!okP) return;
    const list=getAuth();
    const acc=list.find(a=>sameEmail(a.email,em));
    let ok=false;
    try{ ok = !!acc && await verifyPass(acc,pw); }catch(err){ ok=false; }
    if(!ok){ setInvalid('pass',true,'البريد أو كلمة المرور غير صحيحة'); toast('تعذر تسجيل الدخول — تأكد من البيانات','error'); return; }
    if(!acc.hash){ // ترقية حساب قديم كانت كلمة مروره مخزنة نصًا
      try{ acc.salt=newSalt(); acc.hash=await hashPass(pw,acc.salt); delete acc.pass; setAuth(list); }catch(err){}
    }
    startSession({name:acc.name,email:em});
    toast(`أهلًا بيك يا ${acc.name}! يلا نبدأ ننظم مذاكرتك.`); go('#/dashboard');
  };
  $('#demoBtn').onclick=()=>{
    // الحساب التجريبي له مفتاح بيانات خاص به ومش بيتشارك مع أي حساب حقيقي
    startSession({name:'طالب الدحيح',email:DEMO_EMAIL,demo:true});
    toast('دخلت في الوضع التجريبي — بياناتك محفوظة في المتصفح فقط'); go('#/dashboard');
  };
}

function viewRegister(app){
  app.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <div style="text-align:center;margin-bottom:8px">${LOGO}</div>
    <h2>أنشئ حسابك في الدحيح</h2>
    <p class="sub">دقيقة واحدة وتبدأ رحلة تنظيم مذاكرتك</p>
    <div class="demo-note">⚠️ <strong>وضع تجريبي:</strong> الحسابات تُحفظ محليًا في متصفحك وليست آمنة فعليًا، لحد ما نوفر تسجيل دخول حقيقي بقاعدة بيانات.</div>
    <form id="regForm" novalidate>
      ${fieldHTML('name','الاسم الظاهر',{ph:'اكتب اسمك'})}
      ${fieldHTML('email','البريد الإلكتروني','email',{ph:'name@example.com',err:'أدخل بريدًا إلكترونيًا صحيحًا'})}
      ${fieldHTML('pass','كلمة المرور','password',{ph:'6 أحرف على الأقل',err:'كلمة المرور 6 أحرف على الأقل'})}
      ${fieldHTML('pass2','تأكيد كلمة المرور','password',{ph:'••••••••',err:'كلمتا المرور غير متطابقتين'})}
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:6px">إنشاء الحساب</button>
    </form>
    <p style="text-align:center;margin-top:14px;font-size:.88rem">عندك حساب بالفعل؟ <a href="#/login">سجّل دخولك</a></p>
  </div></div>`;
  $('#regForm').onsubmit=async e=>{
    e.preventDefault();
    const name=$('#name').value.trim(), em=$('#email').value.trim().toLowerCase(), pw=$('#pass').value, pw2=$('#pass2').value;
    let ok=true;
    ok = setInvalid('name', !name) && ok;
    ok = setInvalid('email', !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) && ok;
    ok = setInvalid('pass', pw.length<6) && ok;
    ok = setInvalid('pass2', pw!==pw2 || !pw2) && ok;
    if(!ok){ toast('راجع البيانات المطلوبة قبل المتابعة','error'); return; }
    const list=getAuth();
    if(em===DEMO_EMAIL){ setInvalid('email',true,'هذا البريد محجوز للوضع التجريبي'); return; }
    if(list.some(a=>sameEmail(a.email,em))){ setInvalid('email',true,'هذا البريد مسجل بالفعل — جرّب تسجيل الدخول'); return; }
    let salt, hash;
    try{ salt=newSalt(); hash=await hashPass(pw,salt); }catch(err){ toast('تعذّر تأمين كلمة المرور على هذا المتصفح','error'); return; }
    list.push({name,email:em,salt,hash}); setAuth(list);
    startSession({name,email:em});
    toast('تم إنشاء حسابك بنجاح! أهلًا بيك في الدحيح 🎉'); go('#/dashboard');
  };
}

function viewForgot(app){
  app.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <div style="text-align:center;margin-bottom:8px">${LOGO}</div>
    <h2>استعادة كلمة المرور</h2>
    <p class="sub">أدخل بريدك وكلمة المرور الجديدة</p>
    <div class="demo-note">⚠️ في الوضع التجريبي لا يوجد بريد حقيقي، فبنعيّن كلمة المرور الجديدة مباشرة للحساب المسجّل على هذا المتصفح.</div>
    <form id="forgotForm" novalidate>
      ${fieldHTML('email','البريد الإلكتروني','email',{ph:'name@example.com',err:'أدخل بريدًا إلكترونيًا صحيحًا'})}
      ${fieldHTML('newpass','كلمة المرور الجديدة','password',{ph:'6 أحرف على الأقل',err:'كلمة المرور 6 أحرف على الأقل'})}
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:6px">تعيين كلمة المرور</button>
    </form>
    <p style="text-align:center;margin-top:14px;font-size:.88rem"><a href="#/login">← رجوع لتسجيل الدخول</a></p>
  </div></div>`;
  $('#forgotForm').onsubmit=async e=>{
    e.preventDefault();
    const em=$('#email').value.trim().toLowerCase(), pw=$('#newpass').value;
    let ok=setInvalid('email', !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em));
    ok=setInvalid('newpass', pw.length<6)&&ok;
    if(!ok) return;
    const list=getAuth(); const acc=list.find(a=>sameEmail(a.email,em));
    if(!acc){ setInvalid('email',true,'مفيش حساب بالبريد ده على هذا المتصفح'); return; }
    try{ acc.salt=newSalt(); acc.hash=await hashPass(pw,acc.salt); delete acc.pass; setAuth(list); }
    catch(err){ toast('تعذّر تأمين كلمة المرور على هذا المتصفح','error'); return; }
    toast('تم تعيين كلمة مرور جديدة — سجّل دخولك بيها ✅'); go('#/login');
  };
}

/* =========================================================
   App shell + Dashboard
   ========================================================= */
function appShell(inner){
  return `<div class="demo-banner">🧪 <strong>الوضع التجريبي:</strong> بياناتك محفوظة في متصفحك فقط (localStorage) — قاعدة البيانات الحقيقية قيد التطوير.</div>
  <div class="app-shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand">${LOGO} الدحيح</div>
      <a class="side-link" href="#/dashboard">${ICO.home} الرئيسية</a>
      <a class="side-link" href="#/subjects">${ICO.book} المواد الدراسية</a>
      <a class="side-link" href="#/schedule">${ICO.clock} جدول المذاكرة</a>
      <a class="side-link" href="#/tasks">${ICO.check} المهام والواجبات</a>
      <a class="side-link" href="#/calendar">${ICO.cal} التقويم الدراسي</a>
      <a class="side-link" href="#/settings">${ICO.gear} الإعدادات</a>
      <div class="spacer"></div>
      <button class="side-link" id="sideLogout" style="border:none;background:none;width:100%">${ICO.logout} تسجيل الخروج</button>
    </aside>
    <main class="main-area" id="mainArea">${inner}</main>
  </div>`;
}
function mountShell(app, inner){
  app.innerHTML = appShell(inner);
  $('#sideLogout').onclick=doLogout;
}

function weekProgress(){
  const now=new Date(); const day=(now.getDay()+1)%7; // Sunday=0
  const start=new Date(now); start.setDate(now.getDate()-day);
  const end=new Date(start); end.setDate(start.getDate()+7);
  const inWeek = d => { const x=new Date(d+'T00:00:00'); return x>=start && x<end; };
  const createdLocal = t => { const c=t.createdAt?new Date(t.createdAt):null; return (c&&!isNaN(c))? isoDate(c) : ''; };
  const wk=DB.tasks.filter(t=>inWeek(t.due)||(createdLocal(t)&&inWeek(createdLocal(t))));
  if(!wk.length) return null;
  return Math.round(wk.filter(t=>t.status==='done').length / wk.length * 100);
}

function viewDashboard(app){
  const t=todayISO();
  const todaySessions=DB.sessions.filter(s=>s.date===t).sort((a,b)=>a.start.localeCompare(b.start));
  const upcomingTasks=DB.tasks.filter(x=>x.status!=='done').sort((a,b)=>a.due.localeCompare(b.due)).slice(0,5);
  const upcomingExams=DB.events.filter(e=>e.type==='exam'&&e.date>=t).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,4);
  const done=DB.tasks.filter(x=>x.status==='done').length;
  const open=DB.tasks.length-done;
  const prog=weekProgress();
  mountShell(app, `
    <div class="welcome">
      <h2>أهلًا بيك يا ${esc(DB.user.name)}! 👋</h2>
      <div>${fmtDate(t)}</div>
      <div style="margin-top:10px;font-size:.92rem;opacity:.92">يلا نبدأ ننظم مذاكرتك — عندك ${open} مهمة مفتوحة النهاردة.</div>
    </div>
    <div class="stat-grid">
      <div class="stat-card"><div class="num">${DB.subjects.length}</div><div class="lbl">📚 مادة دراسية</div></div>
      <div class="stat-card"><div class="num">${open}</div><div class="lbl">⏳ مهمة غير مكتملة</div></div>
      <div class="stat-card"><div class="num">${done}</div><div class="lbl">✅ مهمة مكتملة</div></div>
      <div class="stat-card"><div class="num">${prog===null?'—':prog+'%'}</div><div class="lbl">📈 تقدمك الأسبوعي</div>
        ${prog!==null?`<div class="progressbar" style="margin-top:8px"><div style="width:${prog}%"></div></div>`:''}</div>
    </div>
    <div class="two-col">
      <div class="panel">
        <h3>📅 جدول مذاكرة اليوم</h3>
        ${todaySessions.length ? todaySessions.map(s=>`
          <div class="list-row">
            <span style="color:${subjectColor(s.subjectId)};font-size:1.2rem">●</span>
            <span class="grow">${esc(s.title)} <small style="color:var(--muted)">(${esc(subjectName(s.subjectId))})</small></span>
            <span class="tag ${s.done?'tag-done':'tag-todo'}">${s.done?'مكتملة':s.start+' - '+s.end}</span>
          </div>`).join('')
        : `<div class="empty"><div class="big">🗓️</div>مفيش جلسات مذاكرة النهاردة.<br><a href="#/schedule">أضف جلسة من جدول المذاكرة</a></div>`}
      </div>
      <div class="panel">
        <h3>✏️ الواجبات القادمة</h3>
        ${upcomingTasks.length ? upcomingTasks.map(x=>`
          <div class="list-row">
            <input type="checkbox" class="chk" data-quickdone="${x.id}" ${x.status==='done'?'checked':''}>
            <span class="grow">${esc(x.title)} <small style="color:var(--muted)">(${esc(subjectName(x.subjectId))})</small><br>
              <small class="${isOverdue(x)?'overdue':''}" style="color:var(--muted)">${isOverdue(x)?'⚠️ تأخرت! التسليم كان ':''}${fmtShort(x.due)}</small></span>
            <span class="tag tag-${x.priority==='high'?'high':x.priority==='low'?'low':'med'}">${x.priority==='high'?'عالية':x.priority==='low'?'منخفضة':'متوسطة'}</span>
          </div>`).join('')
        : `<div class="empty"><div class="big">🎉</div>مفيش واجبات معلّقة — الوضع ممتاز!</div>`}
      </div>
    </div>
    <div class="two-col">
      <div class="panel">
        <h3>📝 الامتحانات القادمة</h3>
        ${upcomingExams.length ? upcomingExams.map(e=>`
          <div class="list-row"><span style="color:#f43f5e">📝</span>
            <span class="grow">${esc(e.title)} <small style="color:var(--muted)">(${esc(subjectName(e.subjectId))})</small></span>
            <span class="tag tag-exam">${fmtShort(e.date)}</span></div>`).join('')
        : `<div class="empty"><div class="big">😌</div>مفيش امتحانات قادمة مسجّلة.</div>`}
      </div>
      <div class="panel">
        <h3>⚡ وصول سريع</h3>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <a class="btn btn-primary btn-sm" href="#/subjects">+ أضف مادة</a>
          <a class="btn btn-ghost btn-sm" href="#/tasks">+ أضف مهمة</a>
          <a class="btn btn-ghost btn-sm" href="#/schedule">+ أضف جلسة مذاكرة</a>
          <a class="btn btn-ghost btn-sm" href="#/calendar">+ أضف حدث</a>
        </div>
        <p style="color:var(--muted);font-size:.88rem;margin-top:14px;line-height:1.9">لو لسه جديد: ابدأ بإضافة أول مادة دراسية، وبعدها سجّل واجباتك وجلسات مذاكرتك.</p>
      </div>
    </div>`);
  document.querySelectorAll('[data-quickdone]').forEach(c=>c.onchange=()=>{
    const x=DB.tasks.find(t2=>t2.id===c.dataset.quickdone);
    if(x){ setTaskDone(x,c.checked); saveDB(); toast(c.checked?'ممتاز! خلصت المهمة دي 🎉':'رجّعنا المهمة للقائمة'); render(); }
  });
}

/* =========================================================
   Views — Subjects
   ========================================================= */
const SUBJECT_COLORS=['#0d9488','#10b981','#0891b2','#6366f1','#8b5cf6','#d946ef','#f43f5e','#f59e0b','#64748b'];

function subjectModal(s){
  const isEdit=!!s; s=s||{};
  openModal(isEdit?'تعديل المادة':'إضافة مادة جديدة', `
    ${fieldHTML('sName','اسم المادة *',{ph:'مثال: رياضيات متقدمة',err:'اسم المادة مطلوب'})}
    ${fieldHTML('sTeacher','اسم المدرس / الدكتور',{ph:'اختياري'})}
    <div class="field"><label>لون المادة</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap" id="colorPick">
        ${SUBJECT_COLORS.map(c=>`<button type="button" class="color-dot ${c===(s.color||SUBJECT_COLORS[0])?'selected':''}" data-c="${c}" aria-label="اختيار اللون ${c}" style="background:${c}"></button>`).join('')}
      </div></div>
    <div class="field"><label for="sNotes">ملاحظات</label><textarea id="sNotes" rows="3" placeholder="اختياري">${esc(s.notes||'')}</textarea></div>
    <div class="field"><label for="sLectures">جدول المحاضرات (اختياري)</label>
      <input id="sLectures" placeholder="مثال: الأحد والثلاثاء 10-12، قاعة 5"></div>
  `,(ov)=>{
    const name=ov.querySelector('#sName').value.trim();
    if(!setInvalid('sName', !name)) return false;
    const color=ov.querySelector('.color-dot.selected')?.dataset.c || SUBJECT_COLORS[0];
    const data={name, teacher:ov.querySelector('#sTeacher').value.trim(), color,
      notes:ov.querySelector('#sNotes').value.trim(), lectures:ov.querySelector('#sLectures').value.trim()};
    if(isEdit) Object.assign(subjectById(s.id), data);
    else DB.subjects.push({id:uid(), createdAt:new Date().toISOString(), ...data});
    saveDB(); toast(isEdit?'تم حفظ التغييرات بنجاح ✅':'تمت إضافة المادة بنجاح 🎉'); render(); return true;
  },{okText:isEdit?'حفظ التعديلات':'إضافة المادة'});
  // init values after mount
  const ov=document.querySelector('.modal-overlay');
  ov.querySelector('#sName').value=s.name||''; ov.querySelector('#sTeacher').value=s.teacher||'';
  ov.querySelector('#sLectures').value=s.lectures||'';   // كان بيتمسح عند التعديل
  ov.querySelectorAll('.color-dot').forEach(b=>b.onclick=()=>{
    ov.querySelectorAll('.color-dot').forEach(x=>x.classList.remove('selected'));
    b.classList.add('selected');
  });
}
function subjectDetailModal(s){
  const ts=DB.tasks.filter(t=>t.subjectId===s.id), ss=DB.sessions.filter(x=>x.subjectId===s.id);
  const done=ts.filter(t=>t.status==='done').length;
  const prog=ts.length?Math.round(done/ts.length*100):0;
  openModal('تفاصيل المادة', `
    <div style="border-inline-start:5px solid ${s.color};padding-inline-start:12px;margin-bottom:16px">
      <h3 style="margin:0">${esc(s.name)}</h3>
      ${s.teacher?`<div style="color:var(--muted);font-size:.9rem">👨‍🏫 ${esc(s.teacher)}</div>`:''}
    </div>
    <p style="line-height:2">
      <strong>الواجبات:</strong> ${ts.length} (${done} مكتملة)<br>
      <strong>جلسات المذاكرة:</strong> ${ss.length} (${ss.filter(x=>x.done).length} مكتملة)<br>
      ${s.lectures?`<strong>المحاضرات:</strong> ${esc(s.lectures)}<br>`:''}
      ${s.notes?`<strong>ملاحظات:</strong> ${esc(s.notes)}`:''}
    </p>
    <div class="progressbar"><div style="width:${prog}%"></div></div>
    <p style="font-size:.82rem;color:var(--muted);margin-top:6px">مؤشر التقدم الدراسي: ${prog}%</p>
  `,()=>true,{okText:'إغلاق'});
}

function viewSubjects(app){
  mountShell(app, `
    <div class="page-head">
      <h2>📚 المواد الدراسية</h2>
      <button class="btn btn-primary" id="addSubject">+ إضافة مادة</button>
    </div>
    <div id="subjectWrap">
    ${DB.subjects.length ? `<div class="subject-grid">${DB.subjects.map(s=>{
        const ts=DB.tasks.filter(t=>t.subjectId===s.id), ss=DB.sessions.filter(x=>x.subjectId===s.id);
        const done=ts.filter(t=>t.status==='done').length;
        const prog=ts.length?Math.round(done/ts.length*100):0;
        return `<div class="subject-card" style="border-top-color:${s.color}">
          <h3>${esc(s.name)}</h3>
          <div class="meta">${s.teacher?esc(s.teacher)+' · ':''}${s.lectures?esc(s.lectures):''}</div>
          <div style="font-size:.85rem;color:var(--muted)">✏️ ${ts.length} واجبات &nbsp;·&nbsp; ⏱️ ${ss.length} جلسة مذاكرة</div>
          <div class="progressbar" style="margin-top:10px"><div style="width:${prog}%"></div></div>
          <div style="font-size:.78rem;color:var(--muted);margin-top:4px">التقدم: ${prog}%</div>
          <div class="row">
            <button class="btn btn-ghost btn-sm" data-view="${s.id}">التفاصيل</button>
            <button class="btn btn-ghost btn-sm" data-edit="${s.id}">تعديل</button>
            <button class="btn btn-danger btn-sm" data-del="${s.id}">حذف</button>
          </div>
        </div>`;}).join('')}</div>`
      : `<div class="card"><div class="empty"><div class="big">📚</div>
          لسه مفيش مواد دراسية. ابدأ بإضافة أول مادة!<br>
          <button class="btn btn-primary" id="emptyAdd" style="margin-top:12px">+ أضف أول مادة دراسية</button></div></div>`}
    </div>`);
  $('#addSubject').onclick=()=>subjectModal(null);
  const ea=$('#emptyAdd'); if(ea) ea.onclick=()=>subjectModal(null);
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>subjectDetailModal(subjectById(b.dataset.view)));
  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>subjectModal(subjectById(b.dataset.edit)));
  document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{
    const s=subjectById(b.dataset.del);
    confirmDialog(`حذف مادة «${s.name}»؟ الواجبات والجلسات والأحداث المرتبطة بيها هتفضل موجودة تحت «بدون مادة»، وتقدر تعيّن لها مادة جديدة من التعديل.`,()=>{
      DB.subjects=DB.subjects.filter(x=>x.id!==s.id);
      [DB.tasks,DB.sessions,DB.events].forEach(arr=>arr.forEach(it=>{ if(it.subjectId===s.id) it.subjectId=''; })); // نفك الربط بدل معرّفات يتيمة
      saveDB(); toast('تم حذف المادة'); render();
    });
  });
}

/* =========================================================
   Views — Weekly schedule
   ========================================================= */
function sessionModal(s, presetDate){
  const isEdit=!!s; s=s||{};
  if(!DB.subjects.length){
    toast('أضف مادة دراسية الأول قبل إضافة جلسة مذاكرة','error');
    openModal('محتاج مادة أولًا',`<p style="line-height:2">عشان تنظم جلسة مذاكرة لازم يكون عندك مادة دراسية. أضف واحدة دلوقتي؟</p>`,()=>{ go('#/subjects'); return true; },{okText:'روح لإضافة مادة'});
    return;
  }
  openModal(isEdit?'تعديل جلسة المذاكرة':'أضف جلسة مذاكرة', `
    <div class="field"><label for="ssSub">المادة الدراسية *</label>
      <select id="ssSub"><option value="">— اختر المادة —</option>${subjectOptions(s.subjectId)}</select>
      <div class="err">اختر المادة الدراسية</div></div>
    ${fieldHTML('ssTitle','عنوان الجلسة *',{ph:'مثال: مراجعة الفصل الثالث',err:'عنوان الجلسة مطلوب'})}
    ${fieldHTML('ssDate','التاريخ *','date',{err:'اختر التاريخ'})}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${fieldHTML('ssStart','وقت البداية *','time',{err:'مطلوب'})}
      ${fieldHTML('ssEnd','وقت النهاية *','time',{err:'مطلوب'})}
    </div>
    ${isEdit?'':`<div class="field"><label for="ssRepeat">التكرار</label>
      <select id="ssRepeat"><option value="1">مرة واحدة</option><option value="4">أسبوعيًا لمدة 4 أسابيع</option>
      <option value="8">أسبوعيًا لمدة 8 أسابيع</option><option value="12">أسبوعيًا لمدة 12 أسبوعًا</option></select></div>`}
    <div class="field"><label for="ssNotes">ملاحظات</label><textarea id="ssNotes" rows="2" placeholder="اختياري"></textarea></div>
  `,(ov)=>{
    const sub=ov.querySelector('#ssSub').value, title=ov.querySelector('#ssTitle').value.trim();
    const date=ov.querySelector('#ssDate').value, st=ov.querySelector('#ssStart').value, en=ov.querySelector('#ssEnd').value;
    let ok=true;
    ok=setInvalid('ssSub',!sub)&&ok; ok=setInvalid('ssTitle',!title)&&ok;
    ok=setInvalid('ssDate',!date)&&ok; ok=setInvalid('ssStart',!st)&&ok; ok=setInvalid('ssEnd',!en)&&ok;
    if(st&&en&&en<=st){ setInvalid('ssEnd',true,'وقت النهاية لازم يكون بعد البداية'); ok=false; }
    if(!ok) return false;
    const data={subjectId:sub,title,date,start:st,end:en,notes:ov.querySelector('#ssNotes').value.trim()};
    if(isEdit) Object.assign(DB.sessions.find(x=>x.id===s.id),data);
    else {
      const weeks=parseInt(ov.querySelector('#ssRepeat')?.value,10)||1;
      for(let i=0;i<weeks;i++){
        const d=new Date(date+'T00:00:00'); d.setDate(d.getDate()+7*i);
        DB.sessions.push({id:uid(),done:false,createdAt:new Date().toISOString(),...data,date:isoDate(d)});
      }
    }
    saveDB(); toast(isEdit?'تم حفظ التعديلات ✅':'تمت إضافة الجلسة 🎉'); render(); return true;
  },{okText:isEdit?'حفظ':'إضافة الجلسة'});
  const ov=document.querySelector('.modal-overlay');
  ov.querySelector('#ssTitle').value=s.title||'';
  ov.querySelector('#ssDate').value=s.date||presetDate||todayISO();
  ov.querySelector('#ssStart').value=s.start||'17:00'; ov.querySelector('#ssEnd').value=s.end||'18:00';
  ov.querySelector('#ssNotes').value=s.notes||'';
}

function viewSchedule(app){
  const now=new Date(); now.setDate(now.getDate()+schedOffset); const dow=(now.getDay()+1)%7;
  const start=new Date(now); start.setDate(now.getDate()-dow);
  const days=[...Array(7)].map((_,i)=>{ const d=new Date(start); d.setDate(start.getDate()+i); return d; });
  const weekSessions=DB.sessions.filter(s=>days.some(d=>isoDate(d)===s.date));
  mountShell(app, `
    <div class="page-head">
      <h2>⏱️ جدول المذاكرة الأسبوعي</h2>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" id="prevW">‹ الأسبوع السابق</button>
        <strong style="color:var(--primary-dark)">${fmtShort(isoDate(days[0]))} — ${fmtShort(isoDate(days[6]))}</strong>
        <button class="btn btn-ghost btn-sm" id="schedToday">الأسبوع الحالي</button>
        <button class="btn btn-ghost btn-sm" id="nextW">الأسبوع التالي ›</button>
        <button class="btn btn-primary" id="addSession">＋ أضف جلسة مذاكرة</button>
      </div>
    </div>
    ${!DB.subjects.length ? `<div class="card"><div class="empty">📚 أضف مادة دراسية الأول عشان تقدر تنظم جلسات المذاكرة.<br><a href="#/subjects" style="font-weight:700">← روح لإضافة مادة</a></div></div>`:
    !weekSessions.length ? `<div class="card"><div class="empty"><div class="big">🗓️</div>مفيش جلسات مذاكرة الأسبوع ده.<br>ابدأ بإضافة أول جلسة ونظّم وقتك.</div></div>`:
    `<div style="overflow-x:auto"><table class="sched-table"><thead><tr>${days.map(d=>`<th>${AR_DAYS[d.getDay()]}<br><small>${d.getDate()} ${AR_MONTHS[d.getMonth()]}</small></th>`).join('')}</tr></thead>
     <tbody><tr>${days.map(d=>{
        const iso=isoDate(d);
        const cells=DB.sessions.filter(s=>s.date===iso).sort((a,b)=>a.start.localeCompare(b.start));
        return `<td>${cells.map(s=>`<button class="sched-cell ${s.done?'done':''}" style="background:${subjectColor(s.subjectId)}" data-sess="${s.id}" title="اضغط للتعديل أو الحذف">
          ${esc(s.title)}<small>${s.start}–${s.end}</small><small>${esc(subjectName(s.subjectId))}</small></button>`).join('')||'<span style="color:#c3d8d3;font-size:.75rem">—</span>'}</td>`;
      }).join('')}</tr></tbody></table></div>
     <p style="color:var(--muted);font-size:.82rem;margin-top:10px">💡 اضغط على أي جلسة عشان تعدّلها أو تمسحها أو تعلّمها كمكتملة.</p>`}
  `);
  $('#addSession').onclick=()=>sessionModal(null, days.some(d=>isoDate(d)===todayISO())?todayISO():isoDate(days[0]));
  const pw=$('#prevW'), nw=$('#nextW');
  if(pw) pw.onclick=()=>{ schedOffset-=7; viewSchedule(app); };
  if(nw) nw.onclick=()=>{ schedOffset+=7; viewSchedule(app); };
  const todayB=$('#schedToday');
  if(todayB) todayB.onclick=()=>{ schedOffset=0; viewSchedule(app); };
  document.querySelectorAll('[data-sess]').forEach(b=>b.onclick=()=>{
    const s=DB.sessions.find(x=>x.id===b.dataset.sess);
    openModal('جلسة المذاكرة', `
      <p style="line-height:2"><strong>${esc(s.title)}</strong><br>
      📚 ${esc(subjectName(s.subjectId))} · 📅 ${fmtDate(s.date)}<br>🕐 ${s.start} — ${s.end}
      ${s.notes?`<br>📝 ${esc(s.notes)}`:''}</p>
      <label style="display:flex;gap:8px;align-items:center;margin:10px 0;font-weight:700">
        <input type="checkbox" id="mDone" ${s.done?'checked':''}> تم إنجاز الجلسة</label>
    `,(ov)=>{
      s.done=ov.querySelector('#mDone').checked; saveDB();
      toast(s.done?'أحسنت! خلّصت الجلسة ✅':'رجّعنا الجلسة للجدول'); render(); return true;
    },{okText:'حفظ الحالة'});
    const ov=document.querySelector('.modal-overlay');
    const act=document.createElement('div'); act.className='modal-actions'; act.style.justifyContent='flex-start'; act.style.marginTop='4px';
    act.innerHTML=`<button type="button" class="btn btn-ghost btn-sm" id="mEdit">✏️ تعديل</button>
                   <button type="button" class="btn btn-danger btn-sm" id="mDel">🗑️ حذف</button>`;
    ov.querySelector('#modalForm').insertBefore(act, ov.querySelector('.modal-actions'));
    ov.querySelector('#mEdit').onclick=()=>{ ov.remove(); sessionModal(s); };
    ov.querySelector('#mDel').onclick=()=>{ ov.remove();
      confirmDialog('حذف جلسة المذاكرة دي؟',()=>{ DB.sessions=DB.sessions.filter(x=>x.id!==s.id); saveDB(); toast('تم حذف الجلسة'); render(); }); };
  });
}
let schedOffset=0;

/* =========================================================
   Views — Tasks
   ========================================================= */
let taskFilter={q:'',subject:'',status:'',sort:'due'};
function taskModal(t){
  const isEdit=!!t; t=t||{};
  if(!DB.subjects.length){ toast('أضف مادة دراسية الأول','error'); go('#/subjects'); return; }
  openModal(isEdit?'تعديل المهمة':'إضافة مهمة جديدة', `
    <div class="field"><label for="tSub">المادة الدراسية *</label>
      <select id="tSub"><option value="">— اختر المادة —</option>${subjectOptions(t.subjectId)}</select>
      <div class="err">اختر المادة الدراسية</div></div>
    ${fieldHTML('tTitle','عنوان المهمة *',{ph:'مثال: حل واجب الفصل الرابع',err:'عنوان المهمة مطلوب'})}
    <div class="field"><label for="tDesc">وصف المهمة</label><textarea id="tDesc" rows="2" placeholder="اختياري"></textarea></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${fieldHTML('tDue','موعد التسليم *','date',{err:'اختر موعد التسليم'})}
      <div class="field"><label for="tPri">الأولوية</label>
        <select id="tPri"><option value="low">منخفضة</option><option value="med" selected>متوسطة</option><option value="high">عالية</option></select></div>
    </div>
    ${isEdit?`<div class="field"><label for="tStatus">الحالة</label>
      <select id="tStatus"><option value="todo">لم تبدأ</option><option value="doing">قيد التنفيذ</option><option value="done">مكتملة</option></select></div>`:''}
  `,(ov)=>{
    const sub=ov.querySelector('#tSub').value, title=ov.querySelector('#tTitle').value.trim(), due=ov.querySelector('#tDue').value;
    let ok=true;
    ok=setInvalid('tSub',!sub)&&ok; ok=setInvalid('tTitle',!title)&&ok; ok=setInvalid('tDue',!due)&&ok;
    if(!ok) return false;
    const data={subjectId:sub,title,desc:ov.querySelector('#tDesc').value.trim(),due,
      priority:ov.querySelector('#tPri').value};
    if(isEdit){ const x=DB.tasks.find(z=>z.id===t.id); Object.assign(x,data); x.status=ov.querySelector('#tStatus').value; }
    else DB.tasks.push({id:uid(),status:'todo',createdAt:new Date().toISOString(),...data});
    saveDB(); toast(isEdit?'تم حفظ التغييرات بنجاح ✅':'تمت إضافة المهمة 🎉'); render(); return true;
  },{okText:isEdit?'حفظ':'إضافة المهمة'});
  const ov=document.querySelector('.modal-overlay');
  ov.querySelector('#tTitle').value=t.title||''; ov.querySelector('#tDesc').value=t.desc||'';
  ov.querySelector('#tDue').value=t.due||todayISO();
  if(t.priority) ov.querySelector('#tPri').value=t.priority;
  if(isEdit) ov.querySelector('#tStatus').value=t.status;
}

function viewTasks(app){
  mountShell(app, `
    <div class="page-head">
      <h2>✏️ المهام والواجبات</h2>
      <button class="btn btn-primary" id="addTask">+ إضافة مهمة</button>
    </div>
    <div class="panel">
      <div class="filter-bar">
        <input id="fQ" type="search" placeholder="🔍 ابحث عن مهمة..." value="${esc(taskFilter.q)}">
        <select id="fSub"><option value="">كل المواد</option>${subjectOptions(taskFilter.subject)}</select>
        <select id="fSt"><option value="">كل الحالات</option>
          <option value="todo" ${taskFilter.status==='todo'?'selected':''}>لم تبدأ</option>
          <option value="doing" ${taskFilter.status==='doing'?'selected':''}>قيد التنفيذ</option>
          <option value="done" ${taskFilter.status==='done'?'selected':''}>مكتملة</option></select>
        <select id="fSort"><option value="due" ${taskFilter.sort==='due'?'selected':''}>ترتيب حسب موعد التسليم</option>
          <option value="pri" ${taskFilter.sort==='pri'?'selected':''}>ترتيب حسب الأولوية</option></select>
      </div>
      <div id="taskList"></div>
    </div>`);
  const draw=()=>{
    let list=DB.tasks.filter(t=>{
      if(taskFilter.q && !normAr((t.title||'')+' '+(t.desc||'')).includes(normAr(taskFilter.q))) return false;
      if(taskFilter.subject && t.subjectId!==taskFilter.subject) return false;
      if(taskFilter.status && t.status!==taskFilter.status) return false;
      return true;
    });
    const priRank={high:0,med:1,low:2};
    list.sort((a,b)=> taskFilter.sort==='pri' ? priRank[a.priority]-priRank[b.priority] || a.due.localeCompare(b.due)
                                                : a.due.localeCompare(b.due));
    $('#taskList').innerHTML = list.length ? list.map(t=>`
      <div class="task-row ${t.status==='done'?'done-task':''}">
        <input type="checkbox" class="chk" data-done="${t.id}" ${t.status==='done'?'checked':''}>
        <div class="grow">
          <div class="title" style="font-weight:700">${esc(t.title)}</div>
          <div style="font-size:.83rem;color:var(--muted)">
            <span style="color:${subjectColor(t.subjectId)}">●</span> ${esc(subjectName(t.subjectId))}
            ${t.desc?` · ${esc(t.desc)}`:''}<br>
            📅 <span class="${isOverdue(t)?'overdue':''}">${isOverdue(t)?'⚠️ متأخرة — كان التسليم ':''}${fmtShort(t.due)}</span>
            &nbsp; <select class="st-sel" data-st="${t.id}" aria-label="حالة المهمة"><option value="todo" ${t.status==='todo'?'selected':''}>لم تبدأ</option><option value="doing" ${t.status==='doing'?'selected':''}>قيد التنفيذ</option><option value="done" ${t.status==='done'?'selected':''}>مكتملة</option></select>
            <span class="tag tag-${t.priority==='high'?'high':t.priority==='low'?'low':'med'}">أولوية ${t.priority==='high'?'عالية':t.priority==='low'?'منخفضة':'متوسطة'}</span>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" data-edit="${t.id}">تعديل</button>
        <button class="btn btn-danger btn-sm" data-del="${t.id}">حذف</button>
      </div>`).join('')
      : `<div class="empty"><div class="big">📋</div>${DB.tasks.length?'لا توجد نتائج مطابقة للفلاتر الحالية.':'لسه مفيش مهام مسجلة — أضف أول واجب ليك!'}</div>`;
    $('#taskList').querySelectorAll('[data-done]').forEach(c=>c.onchange=()=>{
      const x=DB.tasks.find(z=>z.id===c.dataset.done);
      setTaskDone(x,c.checked); saveDB();
      toast(c.checked?'ممتاز! خلصت المهمة دي 🎉':'رجّعنا المهمة للقائمة'); draw();
    });
    $('#taskList').querySelectorAll('[data-st]').forEach(sel=>sel.onchange=()=>{
      const x=DB.tasks.find(z=>z.id===sel.dataset.st); if(!x) return;
      if(sel.value==='done') setTaskDone(x,true); else { x.status=sel.value; delete x.prevStatus; }
      saveDB(); toast('تم تحديث حالة المهمة ✅'); draw();
    });
    $('#taskList').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>taskModal(DB.tasks.find(z=>z.id===b.dataset.edit)));
    $('#taskList').querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{
      const x=DB.tasks.find(z=>z.id===b.dataset.del);
      confirmDialog(`حذف المهمة «${x.title}» نهائيًا؟`,()=>{ DB.tasks=DB.tasks.filter(z=>z.id!==x.id); saveDB(); toast('تم حذف المهمة'); draw(); });
    });
  };
  $('#addTask').onclick=()=>taskModal(null);
  $('#fQ').oninput=e=>{ taskFilter.q=e.target.value; draw(); };
  $('#fSub').onchange=e=>{ taskFilter.subject=e.target.value; draw(); };
  $('#fSt').onchange=e=>{ taskFilter.status=e.target.value; draw(); };
  $('#fSort').onchange=e=>{ taskFilter.sort=e.target.value; draw(); };
  draw();
}

/* =========================================================
   Views — Calendar
   ========================================================= */
let calCursor=new Date(); calCursor.setDate(1);
let calMode='month';
function eventModal(ev, presetDate){
  const isEdit=!!ev; ev=ev||{};
  openModal(isEdit?'تعديل الحدث':'إضافة حدث دراسي جديد', `
    ${fieldHTML('eTitle','عنوان الحدث *',{ph:'مثال: امتحان منتصف الفصل',err:'عنوان الحدث مطلوب'})}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label for="eType">نوع الحدث *</label>
        <select id="eType"><option value="exam">امتحان</option><option value="quiz">كويز / اختبار قصير</option>
        <option value="other">حدث آخر</option></select></div>
      ${fieldHTML('eDate','تاريخ الحدث *','date',{err:'اختر التاريخ'})}
    </div>
    <div class="field"><label for="eSub">المادة الدراسية</label>
      <select id="eSub"><option value="">— بدون مادة / عام —</option>${subjectOptions(ev.subjectId)}</select></div>
    <div class="field"><label for="eDesc">وصف الحدث</label><textarea id="eDesc" rows="2" placeholder="اختياري"></textarea></div>
  `,(ov)=>{
    const title=ov.querySelector('#eTitle').value.trim(), date=ov.querySelector('#eDate').value;
    let ok=setInvalid('eTitle',!title); ok=setInvalid('eDate',!date)&&ok;
    if(!ok) return false;
    const data={title,type:ov.querySelector('#eType').value,date,subjectId:ov.querySelector('#eSub').value||null,
      desc:ov.querySelector('#eDesc').value.trim()};
    if(isEdit) Object.assign(DB.events.find(x=>x.id===ev.id),data);
    else DB.events.push({id:uid(),createdAt:new Date().toISOString(),...data});
    saveDB(); toast(isEdit?'تم حفظ التغييرات ✅':'تمت إضافة الحدث 🎉'); render(); return true;
  },{okText:isEdit?'حفظ':'إضافة الحدث'});
  const ov=document.querySelector('.modal-overlay');
  ov.querySelector('#eTitle').value=ev.title||'';
  ov.querySelector('#eDate').value=ev.date||presetDate||todayISO();
  if(ev.type) ov.querySelector('#eType').value=ev.type;
}
function dayItems(iso){
  const t=todayISO();
  return [
    ...DB.tasks.filter(x=>x.due===iso).map(x=>({kind:'task',title:x.title,ref:x,color:subjectColor(x.subjectId)})),
    ...DB.events.filter(x=>x.date===iso).map(x=>({kind:x.type==='exam'?'exam':x.type==='quiz'?'quiz':'other',title:x.title,ref:x,color:null})),
    ...DB.sessions.filter(x=>x.date===iso).map(x=>({kind:'session',title:x.title,ref:x,color:subjectColor(x.subjectId)}))
  ];
}
function viewCalendar(app){
  const y=calCursor.getFullYear(), m=calCursor.getMonth();
  const first=new Date(y,m,1); const dim=new Date(y,m+1,0).getDate();
  const lead=(first.getDay()+1)%7;
  const t=todayISO();
  let cells='';
  const prevDim=new Date(y,m,0).getDate();
  for(let i=0;i<lead;i++){ cells+=`<div class="cal-cell dim"><div class="d">${prevDim-lead+1+i}</div></div>`; }
  for(let d=1;d<=dim;d++){
    const iso=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const items=dayItems(iso);
    cells+=`<div class="cal-cell ${iso===t?'today':''}" data-day="${iso}" style="cursor:pointer">
      <div class="d">${d}</div>
      ${items.slice(0,3).map(it=>`<span class="cal-chip t-${it.kind}" style="${it.color?`background:${it.color}`:''}" title="${esc(it.title)}">${esc(it.title)}</span>`).join('')}
      ${items.length>3?`<span style="font-size:.65rem;color:var(--muted)">+${items.length-3} أخرى</span>`:''}
    </div>`;
  }
  mountShell(app, `
    <div class="page-head">
      <h2>🗓️ التقويم الدراسي</h2>
      <button class="btn btn-primary" id="addEvent">+ إضافة حدث</button>
    </div>
    <div class="panel">
      <div class="cal-head">
        <button class="btn btn-ghost btn-sm" id="calPrev">‹ السابق</button>
        <h3>${AR_MONTHS[m]} ${y}</h3>
        <button class="btn btn-ghost btn-sm" id="calNext">التالي ›</button>
        <button class="btn btn-ghost btn-sm" id="calToday">اليوم</button>
        <span style="color:var(--muted);font-size:.85rem">(اضغط على يوم لعرض تفاصيله وإضافة حدث فيه)</span>
      </div>
      <div class="legend"><span class="l-task">واجب</span><span class="l-exam">امتحان / كويز</span><span class="l-session">جلسة مذاكرة</span><span class="l-other">حدث آخر</span></div>
      <div class="cal-grid">${WEEK_ORDER.map(i=>`<div class="cal-day-h">${AR_DAYS[i]}</div>`).join('')}${cells}${Array.from({length:(7-(lead+dim)%7)%7},(_,i)=>`<div class="cal-cell dim"><div class="d">${i+1}</div></div>`).join('')}</div>
    </div>`);
  $('#calPrev').onclick=()=>{ calCursor.setMonth(calCursor.getMonth()-1); viewCalendar(app); };
  $('#calNext').onclick=()=>{ calCursor.setMonth(calCursor.getMonth()+1); viewCalendar(app); };
  $('#calToday').onclick=()=>{ calCursor=new Date(); calCursor.setDate(1); viewCalendar(app); };
  $('#addEvent').onclick=()=>{
    
    const nowD=new Date();
    const sameMonth=calCursor.getFullYear()===nowD.getFullYear() && calCursor.getMonth()===nowD.getMonth();
    eventModal(null, sameMonth? todayISO() : isoDate(new Date(calCursor.getFullYear(),calCursor.getMonth(),1)));
  };
  document.querySelectorAll('[data-day]').forEach(c=>c.onclick=()=>{
    const iso=c.dataset.day; const items=dayItems(iso);
    const typeLabel={exam:'امتحان',quiz:'كويز',other:'حدث آخر',session:'جلسة مذاكرة',task:'واجب'};
    const dayOv=openModal(`يوم ${fmtDate(iso)}`, `
      ${items.length?items.map(it=>`
        <div class="list-row">
          <span class="tag ${it.kind==='task'?'tag-todo':it.kind==='session'?'tag-session':it.kind==='exam'?'tag-exam':it.kind==='quiz'?'tag-quiz':'tag-other'}">${typeLabel[it.kind]}</span>
          <span class="grow">${esc(it.title)} ${it.kind==='task'&&it.ref.status==='done'?'✅':''} ${it.kind==='session'&&it.ref.done?'✅':''}</span>
          ${(it.kind==='exam'||it.kind==='quiz'||it.kind==='other')?`<button type="button" class="btn btn-danger btn-sm" data-delo="${it.ref.id}">حذف</button>`:''}
        </div>`).join(''):'<div class="empty">مفيش أحداث في اليوم ده.</div>'}
      <div class="modal-actions" style="justify-content:flex-start;margin-top:8px">
        <button type="button" class="btn btn-primary btn-sm" id="dayAddEvent">+ إضافة حدث في هذا اليوم</button>
      </div>
    `,()=>true,{okText:'إغلاق'});
    // كانت الأزرار بتتربط جوه onSubmit فمكانتش بتشتغل إلا بعد الضغط على «إغلاق»
    dayOv.querySelector('#dayAddEvent').onclick=()=>{ dayOv.remove(); eventModal(null,iso); };
    dayOv.querySelectorAll('[data-delo]').forEach(b=>b.onclick=()=>{
      dayOv.remove();
      confirmDialog('حذف هذا الحدث من التقويم؟',()=>{ DB.events=DB.events.filter(x=>x.id!==b.dataset.delo); saveDB(); toast('تم حذف الحدث'); render(); });
    });
  });
}

/* =========================================================
   Views — Settings
   ========================================================= */
// تنظيف ملف الاستيراد: بنقبل بس الحقول المتوقعة بصيغ سليمة (ألوان/تواريخ/معرّفات بتتحط في HTML)
const reId=/^[\w-]{1,40}$/, reDate=/^\d{4}-\d{2}-\d{2}$/, reTime=/^\d{2}:\d{2}$/, reColor=/^#[0-9a-fA-F]{6}$/;
const clip=(v,n)=>String(v??'').slice(0,n);
function cleanImport(d){
  const list=k=>Array.isArray(d[k])?d[k]:[];
  const sid=v=>reId.test(v)?v:'';
  const subjects=list('subjects').filter(x=>x&&reId.test(x.id)).map(x=>({id:x.id,name:clip(x.name,120),teacher:clip(x.teacher,120),
    color:reColor.test(x.color)?x.color:SUBJECT_COLORS[0],notes:clip(x.notes,1000),lectures:clip(x.lectures,300),createdAt:clip(x.createdAt,40)})).filter(x=>x.name);
  const tasks=list('tasks').filter(x=>x&&reId.test(x.id)&&reDate.test(x.due)).map(x=>({id:x.id,subjectId:sid(x.subjectId),title:clip(x.title,200),desc:clip(x.desc,1000),
    due:x.due,priority:['low','med','high'].includes(x.priority)?x.priority:'med',status:['todo','doing','done'].includes(x.status)?x.status:'todo',createdAt:clip(x.createdAt,40)})).filter(x=>x.title);
  const sessions=list('sessions').filter(x=>x&&reId.test(x.id)&&reDate.test(x.date)&&reTime.test(x.start)&&reTime.test(x.end)).map(x=>({id:x.id,subjectId:sid(x.subjectId),
    title:clip(x.title,200),date:x.date,start:x.start,end:x.end,notes:clip(x.notes,1000),done:!!x.done,createdAt:clip(x.createdAt,40)})).filter(x=>x.title);
  const events=list('events').filter(x=>x&&reId.test(x.id)&&reDate.test(x.date)).map(x=>({id:x.id,subjectId:sid(x.subjectId)||null,title:clip(x.title,200),
    type:['exam','quiz','other'].includes(x.type)?x.type:'other',date:x.date,desc:clip(x.desc,1000),createdAt:clip(x.createdAt,40)})).filter(x=>x.title);
  return {subjects,tasks,sessions,events};
}
function viewSettings(app){
  mountShell(app, `
    <div class="page-head"><h2>⚙️ الإعدادات</h2></div>
    <div class="two-col">
      <div class="panel">
        <h3>الملف الشخصي</h3>
        <div class="field"><label for="setName">الاسم الظاهر</label>
          <input id="setName" value="${esc(DB.user.name)}"></div>
        <div class="field"><label>البريد الإلكتروني</label>
          <input value="${esc(DB.user.email||'غير متاح في الوضع التجريبي')}" disabled style="background:#f1f5f4"></div>
        <button class="btn btn-primary" id="saveProfile">حفظ التغييرات</button>
      </div>
      <div class="panel">
        <h3>تفضيلات المذاكرة</h3>
        <div class="field"><label for="setHours">عدد ساعات المذاكرة المفضلة يوميًا</label>
          <input id="setHours" type="number" min="1" max="12" value="${DB.settings.studyHours}"></div>
        <p style="color:var(--muted);font-size:.85rem;line-height:1.9">هذا الرقم بيظهر كمرجع لك عند تخطيط جلسات المذاكرة.</p>
        <button class="btn btn-primary" id="savePrefs" style="margin-top:8px">حفظ التفضيلات</button>
      </div>
    </div>
    <div class="panel">
      <h3>الحساب</h3>
      <p style="color:var(--muted);font-size:.9rem;line-height:2">أنت الآن في <strong>الوضع التجريبي</strong>: بياناتك تُحفظ في متصفحك فقط عبر localStorage، وأي حذف لبيانات الموقع من المتصفح سيؤدي لضياعها. قاعدة البيانات الحقيقية (Supabase/PostgreSQL) قيد التطوير.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
        <button class="btn btn-ghost" id="exportBtn">⬇️ تصدير نسخة احتياطية (JSON)</button>
        <button class="btn btn-ghost" id="importBtn">⬆️ استيراد نسخة احتياطية</button>
        <input type="file" id="importFile" accept="application/json,.json" hidden>
        <button class="btn btn-danger" id="resetBtn">🗑️ مسح جميع بياناتي</button>
        <button class="btn btn-danger" id="deleteAcctBtn">❌ حذف حسابي نهائيًا</button>
        <button class="btn btn-danger" id="logoutBtn2">🚪 تسجيل الخروج</button>
      </div>
    </div>`);
  $('#saveProfile').onclick=()=>{
    const n=$('#setName').value.trim();
    if(!n){ toast('اكتب اسمًا صحيحًا','error'); return; }
    DB.user.name=n; saveDB();
    { const list=getAuth(); const a=list.find(x=>sameEmail(x.email,DB.user.email)); if(a){ a.name=n; setAuth(list); } }
    toast('تم حفظ التغييرات بنجاح ✅'); render();
  };
  $('#savePrefs').onclick=()=>{
    const h=parseInt($('#setHours').value,10);
    if(!h||h<1||h>12){ toast('أدخل عدد ساعات بين 1 و 12','error'); return; }
    DB.settings.studyHours=h; saveDB(); toast('تم حفظ التفضيلات ✅');
  };
  $('#exportBtn').onclick=()=>{
    const blob=new Blob([JSON.stringify(DB,null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download='eldaheeh-backup-'+todayISO()+'.json'; a.click();
    toast('تم تنزيل النسخة الاحتياطية ✅');
  };
  $('#resetBtn').onclick=()=>confirmDialog('هيتم مسح كل موادك ومهامك وجلساتك وأحداثك نهائيًا. متأكد؟',()=>{
    DB={user:DB.user,subjects:[],tasks:[],sessions:[],events:[],settings:DB.settings};
    saveDB(); toast('تم مسح كل البيانات'); render();
  });
  $('#importBtn').onclick=()=>$('#importFile').click();
  $('#importFile').onchange=e=>{
    const f=e.target.files[0]; e.target.value=''; if(!f) return;
    const r=new FileReader();
    r.onload=()=>{
      let d=null; try{ d=JSON.parse(r.result); }catch(err){}
      if(!d || typeof d!=='object' || !['subjects','tasks','sessions','events'].some(k=>Array.isArray(d[k]))){
        toast('الملف مش نسخة احتياطية صالحة من الدحيح','error'); return;
      }
      const clean=cleanImport(d);
      confirmDialog(`هيتم استبدال بياناتك الحالية بمحتوى النسخة الاحتياطية (${clean.subjects.length} مادة، ${clean.tasks.length} مهمة، ${clean.sessions.length} جلسة، ${clean.events.length} حدث). متأكد؟`,()=>{
        const h=parseInt(d.settings&&d.settings.studyHours,10);
        DB={ user:DB.user, ...clean, settings:{ ...DB.settings, studyHours:(h>=1&&h<=12)?h:DB.settings.studyHours } };
        saveDB(); toast('تم استيراد النسخة الاحتياطية ✅'); render();
      });
    };
    r.readAsText(f);
  };
  $('#deleteAcctBtn').onclick=()=>confirmDialog('هيتم حذف حسابك وكل بياناتك من هذا المتصفح نهائيًا. متأكد؟',()=>{
    const em=DB.user.email;
    setAuth(getAuth().filter(a=>!sameEmail(a.email,em)));
    lsDel(userKey(em)); lsDel(LS_SESSION);
    DB={ user:null, ...emptyData() }; toast('تم حذف حسابك'); go('#/home');
  });
  $('#logoutBtn2').onclick=doLogout;
}

/* =========================================================
   Boot
   ========================================================= */
window.addEventListener('hashchange',render);
loadDB();
applyTheme(getTheme());
if(!location.hash) location.hash = DB.user ? '#/dashboard' : '#/home';
render();