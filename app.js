// Neo UI — App Logic with Firebase Auth + Firestore (v10 modular)
// Includes: Login/Signup with role (Candidate/Employer/Employee alias),
// email verification gating, forgot password, employer approval,
// admin approve/reject, featured + archived sections, and auto-archive (admin client).

// ------------------------------
// Firebase (CDN, modular v10)
// ------------------------------
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendEmailVerification, updateProfile, setPersistence, browserLocalPersistence,
  sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import {
  getFirestore, collection, addDoc, onSnapshot, serverTimestamp, query, orderBy,
  updateDoc, doc, getDoc, setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

// ------------------------------
// Firebase Config (your project)
// ------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyBstvmJZrn231V10wHcSBxYn2qN-7bgyGA",
  authDomain: "my-jobsearch-28d9d.firebaseapp.com",
  projectId: "my-jobsearch-28d9d",
  storageBucket: "my-jobsearch-28d9d.appspot.com",
  messagingSenderId: "407120108131",
  appId: "1:407120108131:web:ec7f49c3cc3a233169f656",
  measurementId: "G-CFRN6P8ZQG"
};

let app, auth, db, unsubscribeJobs = null;
let firebaseReady = false;

function toast(msg) {
  const wrap = document.getElementById('toasts'); if (!wrap) return alert(msg);
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; wrap.appendChild(t);
  // fade out
  setTimeout(() => { t.style.opacity = 0; t.style.transform = 'translateY(-6px)'; }, 2000);
  setTimeout(() => t.remove(), 2600);
}

function initFirebase() {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    setPersistence(auth, browserLocalPersistence);
    db = getFirestore(app);
    firebaseReady = true;
  } catch (e) {
    console.error('Firebase init error', e);
    toast('Firebase init failed, see console');
  }
}

// ------------------------------
// App State
// ------------------------------
const state = {
  role: 'GUEST',             // 'GUEST' | 'CANDIDATE' | 'EMPLOYER' | 'ADMIN'
  user: null,                // { uid, email, displayName, emailVerified, employerApproved? }
  saved: new Set(JSON.parse(localStorage.getItem('savedJobs') || '[]')),
  jobs: []
};

// ------------------------------
// Preset Lists (for dropdowns)
// ------------------------------
const SUBJECTS = ["Mathematics","Computer Science","Physics","Chemistry","Biology","Economics","Electrical Engineering","Mechanical Engineering","Civil Engineering","Management","Statistics","Data Science"]; 
const LEVELS = ["Assistant Professor","Associate Professor","Full Professor","Lecturer","Postdoctoral Researcher","Research Scientist"]; 
const INSTITUTIONS = ["IIT Patna","IISc Bangalore","IIT Bombay","IIT Madras","IIT Delhi","IIM Ahmedabad","MIT","Stanford University","Harvard University","UC Berkeley","Caltech","NIT Trichy"]; 
const LOCATIONS = ["Patna, Bihar, India","Delhi, India","Mumbai, Maharashtra, India","Chennai, Tamil Nadu, India","Bengaluru, Karnataka, India","Cambridge, MA, USA","Stanford, CA, USA","Pasadena, CA, USA","Berkeley, CA, USA","Princeton, NJ, USA"]; 

// ------------------------------
// Tiny DOM helpers
// ------------------------------
const $ = (q, el=document) => el.querySelector(q);
const $$ = (q, el=document) => Array.from(el.querySelectorAll(q));
const fmtDate = (d) => new Date(d).toLocaleDateString();
const daysLeft = (d) => Math.ceil((new Date(d) - new Date()) / (1000*60*60*24));
function saveSync() { localStorage.setItem('savedJobs', JSON.stringify([...state.saved])); const kpi = $('#kpiSaved'); if (kpi) kpi.textContent = state.saved.size; }

// ------------------------------
// Theme
// ------------------------------
(function initTheme(){
  const last = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-color-scheme', last);
  const t = $('#themeToggle'); if (t) t.textContent = last === 'dark' ? '☀️' : '🌙';
})();
const themeBtn = $('#themeToggle');
if (themeBtn) themeBtn.addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-color-scheme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-color-scheme', next);
  localStorage.setItem('theme', next);
  themeBtn.textContent = next === 'dark' ? '☀️' : '🌙';
  toast(`Switched to ${next} mode`);
});

// ------------------------------
// Filters + dropdown helpers
// ------------------------------
function populateFilters() {
  const fDept = $('#fDept'), fLevel = $('#fLevel'), fLoc = $('#fLoc');
  if (!fDept || !fLevel || !fLoc) return;
  const depts = [...new Set(state.jobs.flatMap(j => j.departments||[]))].sort();
  const levels = [...new Set(state.jobs.flatMap(j => j.levels||[]))].sort();
  const locs = [...new Set(state.jobs.map(j => (j.location||'').split(',')[1]?.trim()).filter(Boolean))].sort();

  const apply = (sel, arr) => {
    const existing = new Set([...sel.options].map(o => o.value));
    arr.forEach(v => { if (!existing.has(v)) sel.add(new Option(v, v)); });
  };
  apply(fDept, depts); apply(fLevel, levels); apply(fLoc, locs);
}

function fillSelect(id, list, includeOther=true) {
  const sel = document.getElementById(id); if (!sel) return;
  const opts = [...list.map(v => `<option value="${v}">${v}</option>`), includeOther?'<option value="__other__">Other…</option>':''].join('');
  sel.innerHTML = opts;
}
function attachOtherToggle(selectId, wrapId) {
  const sel = document.getElementById(selectId); const wrap = document.getElementById(wrapId);
  if (!sel || !wrap) return;
  const onChange = () => {
    const values = Array.from(sel.selectedOptions).map(o=>o.value);
    wrap.style.display = values.includes('__other__') ? '' : 'none';
  };
  sel.addEventListener('change', onChange); onChange();
}
function getSelectOrOther(selectId, otherId) {
  const sel = document.getElementById(selectId); const other = document.getElementById(otherId);
  if (!sel) return '';
  if (sel.value === '__other__') return (other?.value || '').trim();
  return sel.value;
}
function getMulti(selectId, otherId) {
  const sel = document.getElementById(selectId); const other = document.getElementById(otherId);
  const base = sel ? Array.from(sel.selectedOptions).map(o=>o.value).filter(v=>v !== '__other__') : [];
  const extra = (other?.value || '').split(',').map(s=>s.trim()).filter(Boolean);
  return [...new Set([...base, ...extra])];
}
function initPostDropdowns() {
  const insts = Array.from(new Set([...INSTITUTIONS, ...state.jobs.map(j=>j.institution||'').filter(Boolean)]));
  const locs = Array.from(new Set([...LOCATIONS, ...state.jobs.map(j=>j.location||'').filter(Boolean)]));
  const subs = Array.from(new Set([...SUBJECTS, ...state.jobs.flatMap(j=>j.departments||[])]));
  const lvls = Array.from(new Set([...LEVELS, ...state.jobs.flatMap(j=>j.levels||[])]));
  fillSelect('pInstSel', insts, true);
  fillSelect('pLocSel',  locs,  true);
  fillSelect('pDept',     subs,  true);
  fillSelect('pLevel',    lvls,  true);
  attachOtherToggle('pInstSel','pInstOtherWrap');
  attachOtherToggle('pLocSel','pLocOtherWrap');
  attachOtherToggle('pDept','pDeptOtherWrap');
  attachOtherToggle('pLevel','pLevelOtherWrap');
  const selectFirst = (id) => { const el = document.getElementById(id); if (el && el.options.length) el.selectedIndex = 0; };
  selectFirst('pDept'); selectFirst('pLevel');
}

// ------------------------------
// Rendering
// ------------------------------
function jobCard(j) {
  const dl = daysLeft(j.deadline);
  const expired = dl < 0 || j.archived || j.active === false;
  const deadlineText = expired ? 'Expired' : (dl <= 7 ? `${dl} day${dl!==1?'s':''} left` : fmtDate(j.deadline));
  const deadlineCls = expired ? '' : (dl <= 7 ? 'deadline urgent' : 'deadline');
  const pending = j.approved === null;
  const isOwner = !!state.user && j.postedByUid === state.user.uid;

  // ADMIN controls: Approve/Reject for pending + Archive/Unarchive always for admin
  let adminControls = '';
  if (state.role === 'ADMIN') {
    const approveBtns = pending
      ? `<button class="btn" data-approve="${j.id}">Approve</button>
         <button class="btn" data-reject="${j.id}">Reject</button>`
      : '';
    const archiveBtn = j.archived
      ? `<button class="btn" data-unarchive="${j.id}">Unarchive</button>`
      : `<button class="btn" data-archive="${j.id}">Archive</button>`;
    adminControls = `<div class="admin-actions">${approveBtns}${archiveBtn}</div>`;
  }

  const status = pending ? '<span class="status pending">Pending Approval</span>'
                         : (j.approved ? '<span class="status approved">Approved</span>' : '');
  const ownerChip = isOwner && pending ? '<span class="tag">Your submission</span>' : '';

  return `<article class="card" data-id="${j.id}">
    <div class="job-head">
      <div>
        <h4 class="title">${j.title}</h4>
        <div class="inst">${j.institution} • ${j.location}</div>
      </div>
      ${status}
    </div>
    <div class="meta">${ownerChip} ${(j.departments||[]).map(d => `<span class="tag">${d}</span>`).join('')} ${(j.levels||[]).map(l => `<span class=tag>${l}</span>`).join('')}</div>
    <p class="desc">${j.description||''}</p>
    <div class="footer">
      <div>
        <div class="${deadlineCls}">${deadlineText}</div>
        ${j.salaryRange ? `<div style="font-size:12px;color:var(--color-text-2)">${j.salaryRange}</div>` : ''}
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        ${j.applicationLink ? `<a class="btn" href="${j.applicationLink}" target="_blank" rel="noopener">Apply</a>` : ''}
        <button class="btn" data-details="${j.id}">Details</button>
        <button class="btn ${state.saved.has(j.id)?'primary':''}" data-save="${j.id}">${state.saved.has(j.id)?'Saved':'Save'}</button>
      </div>
    </div>
    ${adminControls}
  </article>`;
}

function renderJobs() {
  const grid = $('#grid'); if (!grid) return;
  const q = ($('#q')?.value || '').trim().toLowerCase();
  const fd = $('#fDept')?.value || ''; const fl = $('#fLevel')?.value || ''; const fL = $('#fLoc')?.value || '';

  let list = state.jobs.filter(j => j.active !== false && !j.archived);

  // Visibility: Admin sees all; everyone sees approved; owner sees their own pending
  list = list.filter(j => {
    const approved = j.approved === true;
    const mine = state.user && j.postedByUid === state.user.uid;
    const admin = state.role === 'ADMIN';
    return admin || approved || mine;
  });

  list = list.filter(j => (
    (!q || (j.title||'').toLowerCase().includes(q) || (j.institution||'').toLowerCase().includes(q)) &&
    (!fd || (j.departments||[]).includes(fd)) && (!fl || (j.levels||[]).includes(fl)) &&
    (!fL || ((j.location||'').split(',')[1]||'').trim() === fL)
  ));

  const ri = $('#resultsInfo'); if (ri) ri.textContent = `${list.length} position${list.length!==1?'s':''} found`;
  grid.innerHTML = list.length ? list.map(jobCard).join('') : '';
  const empty = $('#emptyState'); if (empty) empty.style.display = list.length ? 'none' : 'block';

  const kpiA = $('#kpiActive'); if (kpiA) kpiA.textContent = state.jobs.filter(j => j.active !== false && !j.archived && j.approved).length;
}

function renderFeatured() {
  const grid = $('#featuredGrid'); if (!grid) return;
  const today = new Date(); const soon = new Date(); soon.setDate(today.getDate()+30);
  const list = state.jobs
    .filter(j => j.active !== false && !j.archived && j.approved && new Date(j.deadline) >= today && new Date(j.deadline) <= soon)
    .slice(0, 6);
  grid.innerHTML = list.length ? list.map(jobCard).join('') : '<div class="empty">No featured jobs right now.</div>';
  const kpiF = $('#kpiFeatured'); if (kpiF) kpiF.textContent = list.length;
}

function renderArchived() {
  const grid = $('#archivedGrid'); if (!grid) return;
  const today = new Date();
  const list = state.jobs.filter(j => j.archived || new Date(j.deadline) < today);
  grid.innerHTML = list.length ? list.map(jobCard).join('') : '<div class="empty">No archived jobs.</div>';
}

function renderAll() { renderJobs(); renderFeatured(); renderArchived(); populateFilters(); }

// ------------------------------
// Auto-archive (ADMIN client writes flags)
// ------------------------------
async function autoArchiveExpiredJobs() {
  if (!firebaseReady || state.role !== 'ADMIN') return;
  const today = new Date();
  for (const j of state.jobs) {
    if (!j.archived && j.active !== false && new Date(j.deadline) < today) {
      try { await updateDoc(doc(db, 'jobs', j.id), { archived: true, active: false }); } catch(e){ /* ignore */ }
    }
  }
}

// ------------------------------
// Firestore sync
// ------------------------------
function subscribeJobs() {
  if (!firebaseReady || !db) return;
  if (unsubscribeJobs) unsubscribeJobs();
  const qy = query(collection(db, 'jobs'), orderBy('createdAt', 'desc'));
  unsubscribeJobs = onSnapshot(qy, async (snap) => {
    state.jobs = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString().slice(0,10) : (data.createdAt || '')
      };
    });
    renderAll();
    await autoArchiveExpiredJobs();
  }, (err) => { console.error(err); toast('Failed to load jobs'); });
}

// ------------------------------
// Auth UI refs
// ------------------------------
const authEls = {
  signInBtn: $('#signInBtn'), signOutBtn: $('#signOutBtn'),
  authModal: $('#authModal'), closeAuth: $('#closeAuth'),
  modeSignin: $('#modeSignin'), modeSignup: $('#modeSignup'),
  authTitle: $('#authTitle'), nameWrap: $('#nameWrap'), authName: $('#authName'),
  authEmail: $('#authEmail'), authPass: $('#authPass'), authSubmit: $('#authSubmit'),
  sendVerify: $('#sendVerify'), verifyNote: $('#verifyNote'),
  forgotPass: $('#forgotPass'), roleName: $('#roleName'),
  roleWrap: $('#roleWrap')
};

function openAuth(mode='signin') {
  if (!authEls.authModal) return;
  authEls.authTitle.textContent = mode === 'signup' ? 'Create Account' : 'Login';
  authEls.nameWrap.hidden = mode !== 'signup';
  authEls.roleWrap.hidden = mode !== 'signup';
  authEls.authModal.classList.add('show');
  authEls.modeSignin.classList.toggle('primary', mode==='signin');
  authEls.modeSignup.classList.toggle('primary', mode==='signup');
  authEls.authSubmit.dataset.mode = mode;
}
function closeAuth() { if (authEls.authModal) authEls.authModal.classList.remove('show'); }

// Buttons
if (authEls.signInBtn) authEls.signInBtn.addEventListener('click', () => openAuth('signin'));
if (authEls.signOutBtn) authEls.signOutBtn.addEventListener('click', async () => { await signOut(auth); toast('Signed out'); });
if (authEls.closeAuth) authEls.closeAuth.addEventListener('click', closeAuth);
if (authEls.modeSignin) authEls.modeSignin.addEventListener('click', () => openAuth('signin'));
if (authEls.modeSignup) authEls.modeSignup.addEventListener('click', () => openAuth('signup'));

// ------------------------------
// Login / Sign Up with role selection (+ Employee alias)
// ------------------------------
if (authEls.authSubmit) authEls.authSubmit.addEventListener('click', async () => {
  if (!firebaseReady) { toast('Add Firebase config first'); return; }
  const mode = authEls.authSubmit.dataset.mode || 'signin';
  const email = authEls.authEmail.value.trim(); const pass = authEls.authPass.value;
  if (!email || !pass) return toast('Enter email & password');

  try {
    if (mode === 'signup') {
      let selectedRole = (document.querySelector('input[name="authRole"]:checked')?.value) || 'CANDIDATE';
      if (selectedRole === 'EMPLOYEE') selectedRole = 'CANDIDATE'; // alias

      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      const name = authEls.authName.value.trim();
      if (name) await updateProfile(cred.user, { displayName: name });

      const userDoc = {
        email,
        displayName: name || '',
        role: selectedRole,
        employerApproved: selectedRole === 'EMPLOYER' ? false : undefined,
        createdAt: serverTimestamp()
      };
      await setDoc(doc(db, 'users', cred.user.uid), userDoc, { merge: true });

      await sendEmailVerification(cred.user);
      toast(selectedRole === 'EMPLOYER'
        ? 'Employer account created. Verify email, then wait for admin approval.'
        : 'Account created. Verification email sent. Verify, then login.');
      await signOut(auth);          // enforce verification before login
      openAuth('signin');           // switch back to login
      if (authEls.verifyNote) authEls.verifyNote.style.display = ''; // reminder
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
      toast('Logged in');
      closeAuth();
    }
  } catch (e) {
    console.error(e); toast(e.message || 'Auth error');
  }
});

// Forgot Password
if (authEls.forgotPass) authEls.forgotPass.addEventListener('click', async () => {
  try {
    let email = authEls.authEmail.value.trim();
    if (!email) email = window.prompt('Enter your account email for password reset:')?.trim();
    if (!email) return;
    await sendPasswordResetEmail(auth, email);
    toast('Password reset email sent');
  } catch (e) {
    console.error(e); toast('Failed to send reset email');
  }
});

// Resend verification (robust: signs in briefly if needed)
const resendBtn = $('#sendVerify');
if (resendBtn) resendBtn.addEventListener('click', async () => {
  try {
    if (auth?.currentUser) {
      await sendEmailVerification(auth.currentUser);
      toast('Verification email sent');
      return;
    }
    const email = authEls.authEmail.value.trim();
    const pass  = authEls.authPass.value;
    if (!email || !pass) { toast('Enter email & password first'); return; }
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    await sendEmailVerification(cred.user);
    await signOut(auth);
    toast('Verification email sent');
  } catch (e) {
    console.error(e); toast('Could not send verification email');
  }
});

// React to auth state
function updateAuthUI() {
  const u = state.user;
  if (authEls.signInBtn)  authEls.signInBtn.style.display = u ? 'none' : '';
  if (authEls.signOutBtn) authEls.signOutBtn.style.display = u ? '' : 'none';

  let label = state.role || (u ? 'CANDIDATE' : 'GUEST');
  if (label === 'EMPLOYER' && !state.user?.employerApproved) label = 'EMPLOYER (pending)';
  if (authEls.roleName) authEls.roleName.textContent = label;

  const unverified = (u && !u.emailVerified);
  if (authEls.verifyNote) authEls.verifyNote.style.display = unverified ? '' : 'none';
  if (resendBtn) resendBtn.style.display = unverified ? '' : 'none';
}

// ------------------------------
// Job actions (post / approve / reject / save / details)
// ------------------------------
const postBtn = $('#postJobBtn');
if (postBtn) postBtn.addEventListener('click', (e) => {
  e.preventDefault();
  if (!state.user) { openAuth('signin'); return; }
  if (!state.user.emailVerified) { openAuth('signin'); toast('Please verify your email first'); return; }
  if (state.role === 'EMPLOYER' && !state.user.employerApproved) {
    toast('Your employer account is awaiting admin approval.');
    return;
  }
  initPostDropdowns(); $('#postModal')?.classList.add('show');
});
const closePost = $('#closePost'); if (closePost) closePost.addEventListener('click', () => $('#postModal')?.classList.remove('show'));

const submitPost = $('#submitPost');
if (submitPost) submitPost.addEventListener('click', async () => {
  if (!state.user) { openAuth('signin'); return; }
  if (!state.user.emailVerified) { toast('Verify your email to post'); return; }
  if (state.role === 'EMPLOYER' && !state.user.employerApproved) { toast('Employer approval pending'); return; }

  const title = $('#pTitle')?.value.trim();
  const inst = getSelectOrOther('pInstSel','pInstOther');
  const loc  = getSelectOrOther('pLocSel','pLocOther');
  const dept = getMulti('pDept','pDeptOther');
  const level= getMulti('pLevel','pLevelOther');
  const desc = $('#pDesc')?.value.trim();
  const dead = $('#pDead')?.value.trim();
  const link = $('#pLink')?.value.trim();
  if (!title || !inst || !loc || !desc || !dead || dept.length===0 || level.length===0) { toast('Please complete all required fields'); return; }

  try {
    const approved =
      (state.role === 'ADMIN') ? true :
      (state.role === 'EMPLOYER' && state.user.employerApproved) ? true :
      null;

    await addDoc(collection(db, 'jobs'), {
      title, institution:inst, location:loc, departments:dept, levels:level,
      description:desc, deadline:dead, applicationLink:link || '', salaryRange:'',
      approved, active:true, archived:false, postedByUid: state.user.uid, createdAt: serverTimestamp()
    });

    $('#postModal')?.classList.remove('show');
    ['pTitle','pInstOther','pLocOther','pDeptOther','pLevelOther','pDesc','pDead','pLink'].forEach(id => { const el = document.getElementById(id); if (el) el.value=''; });
    toast(approved ? 'Job posted' : 'Submitted for approval');
  } catch (e) { console.error(e); toast('Failed to post job'); }
});

// Grid delegated events
const grid = $('#grid'); if (grid) grid.addEventListener('click', async (e) => {
  const save = e.target.closest?.('[data-save]');
  const det  = e.target.closest?.('[data-details]');
  const ap   = e.target.closest?.('[data-approve]');
  const rj   = e.target.closest?.('[data-reject]');

  if (save) {
    const id = save.getAttribute('data-save');
    if (state.saved.has(id)) state.saved.delete(id); else state.saved.add(id);
    saveSync(); renderJobs(); toast(state.saved.has(id) ? 'Job saved' : 'Removed from saved');
  }
  if (det) { openDetails(det.getAttribute('data-details')); }
  if (ap) {
    if (state.role !== 'ADMIN') return toast('Admin only');
    const id = ap.getAttribute('data-approve');
    try { await updateDoc(doc(db, 'jobs', id), { approved: true }); toast('Approved'); } catch(e){ console.error(e); toast('Approval failed'); }
  }
  if (rj) {
    if (state.role !== 'ADMIN') return toast('Admin only');
    const id = rj.getAttribute('data-reject');
    try { await updateDoc(doc(db, 'jobs', id), { approved: false, active:false }); toast('Rejected'); } catch(e){ console.error(e); toast('Rejection failed'); }
  }
});
const fGrid = $('#featuredGrid'); if (fGrid) fGrid.addEventListener('click', (e) => {
  const det = e.target.closest?.('[data-details]');
  const save = e.target.closest?.('[data-save]');
  if (det) { openDetails(det.getAttribute('data-details')); }
  if (save) { const id = save.getAttribute('data-save'); if (state.saved.has(id)) state.saved.delete(id); else state.saved.add(id); saveSync(); renderFeatured(); toast(state.saved.has(id) ? 'Job saved' : 'Removed from saved'); }
});

function openDetails(id) {
  const j = state.jobs.find(x => x.id === id); if (!j) return;
  const dl = daysLeft(j.deadline); const expired = dl < 0;
  const body = $('#detailsBody'); if (!body) return;
  body.innerHTML = `
    <div class="stack-4">
      <div style="display:flex; justify-content:space-between; align-items:start; gap:16px">
        <div>
          <h3 style="margin:.2rem 0">${j.title}</h3>
          <div style="color:var(--color-text-2)">${j.institution} • ${j.location}</div>
        </div>
        ${j.approved===null?'<span class="status pending">Pending Approval</span>':''}
      </div>
      <div class="meta">${(j.departments||[]).map(d => `<span class=tag>${d}</span>`).join('')} ${(j.levels||[]).map(l => `<span class=tag>${l}</span>`).join('')}</div>
      <p>${j.description||''}</p>
      <div style="display:flex; gap:10px; align-items:center; justify-content:space-between">
        <div class="deadline ${expired ? '' : (dl<=7 ? 'urgent':'')}">${expired?'Expired':`Deadline: ${fmtDate(j.deadline)} (${dl} day${dl!==1?'s':''} left)`}</div>
        <div style="display:flex; gap:8px">
          ${j.applicationLink?`<a class="btn" href="${j.applicationLink}" target="_blank" rel="noopener">Apply</a>`:''}
          <button class="btn" data-save="${j.id}">${state.saved.has(j.id)?'Saved':'Save'}</button>
        </div>
      </div>
    </div>`;
  $('#detailsModal')?.classList.add('show');
}
const closeDetails = $('#closeDetails'); if (closeDetails) closeDetails.addEventListener('click', () => $('#detailsModal')?.classList.remove('show'));

// ------------------------------
// Auth state + user profile doc
// ------------------------------
async function hydrateFromUserDoc(user) {
  const uref = doc(db, 'users', user.uid);
  const snap = await getDoc(uref);
  if (!snap.exists()) {
    await setDoc(uref, { email: user.email, displayName: user.displayName || '', role: 'CANDIDATE', createdAt: serverTimestamp() });
    state.role = 'CANDIDATE';
    state.user = { ...state.user, employerApproved: false };
  } else {
    const data = snap.data();
    state.role = data.role || 'CANDIDATE';
    state.user = { ...state.user, employerApproved: !!data.employerApproved };
  }
}

initFirebase();
subscribeJobs();

onAuthStateChanged(auth, async (user) => {
  if (user) {
    if (!user.emailVerified) {
      // Enforce verification before completing login
      state.user = null; state.role = 'GUEST';
      openAuth('signin');
      if (authEls.verifyNote) authEls.verifyNote.style.display = '';
      if (resendBtn) resendBtn.style.display = '';
      toast('Please verify your email, then login.');
      await signOut(auth);
      return;
    }
    state.user = { uid: user.uid, email: user.email, displayName: user.displayName || '', emailVerified: true };
    await hydrateFromUserDoc(user);
    updateAuthUI();
    renderAll();
  } else {
    state.user = null; state.role = 'GUEST';
    updateAuthUI();
    renderAll();
  }
});

// ------------------------------
// Global listeners
// ------------------------------
['q','fDept','fLevel','fLoc'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', renderJobs);
});
const clearFilters = $('#clearFilters');
if (clearFilters) clearFilters.addEventListener('click', () => {
  const q = $('#q'), d = $('#fDept'), l = $('#fLevel'), L = $('#fLoc');
  if (q) q.value=''; if (d) d.value=''; if (l) l.value=''; if (L) L.value='';
  renderJobs();
});

// ------------------------------
// Self-test (utilities)
// ------------------------------
(function runSelfTests(){
  try { if (typeof daysLeft('2099-01-01') !== 'number') throw new Error('daysLeft'); } catch(e){ console.warn('Self-test failed:', e); }
})();
