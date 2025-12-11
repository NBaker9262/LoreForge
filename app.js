// Simple modular demo for DM-hosted sessions using Firebase Realtime DB + Storage (compat).
// NOTE: This is a demo starter. Harden rules & validate inputs for production.

const firebaseConfig = {
  apiKey: "AIzaSyA66xqYt8GZCxRxegAo8ilq2tmqEL4mC_0",
  authDomain: "loreforge-e5c62.firebaseapp.com",
  projectId: "loreforge-e5c62",
  storageBucket: "loreforge-e5c62.firebasestorage.app",
  messagingSenderId: "529682812294",
  appId: "1:529682812294:web:7e4b9cf64b48e813dff007",
  measurementId: "G-E3HLEWVKJN"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();
const storage = firebase.storage();

///// UI refs
const btnSignin = document.getElementById('btn-signin');
const btnSignout = document.getElementById('btn-signout');
const userDisplay = document.getElementById('user-display');
const sessionIdInput = document.getElementById('session-id-input');
const btnCreateSession = document.getElementById('btn-create-session');
const btnJoinSession = document.getElementById('btn-join-session');
const sessionTitle = document.getElementById('session-title');
const sessionInfo = document.getElementById('session-info');
const dmTools = document.getElementById('dm-tools');
const mapUpload = document.getElementById('map-upload');
const mapCanvas = document.getElementById('map-canvas');
const overlayFog = document.getElementById('overlay-fog');
const mapWrap = document.getElementById('map-wrap');
const btnPlaceToken = document.getElementById('btn-place-token');
const btnUploadPfp = document.getElementById('btn-upload-pfp');
const filePfp = document.getElementById('file-pfp');
const tokensInfo = document.getElementById('tokens-info');
const chatLog = document.getElementById('chat-log');
const chatIn = document.getElementById('chat-in');
const chatSend = document.getElementById('chat-send');
const playersList = document.getElementById('players-list');
const btnSaveNotes = document.getElementById('btn-save-notes');
const sessionNotes = document.getElementById('session-notes');
const charactersList = document.getElementById('characters-list');
const btnNewCharacter = document.getElementById('btn-new-character');

const ctx = mapCanvas.getContext('2d');

let currentUser = null;
let currentRole = 'viewer';
let sessionId = null;
let sessionRef = null;
let tokens = {}; // id -> data
let localCharacters = {}; // fallback
let gridSnap = false;
let fogEnabled = true;
let showFog = false;
let initiative = [];
let turnIndex = -1;

// helpers
function uidShort(uid){ return uid ? uid.slice(0,6) : 'anon'; }
function randId(prefix='id'){ return prefix + '_' + Date.now().toString(36) + '_' + Math.floor(Math.random()*1000); }

// ---------- Auth ----------
btnSignin.onclick = async () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  try { await auth.signInWithPopup(provider); } catch (e){ alert(e.message); }
};
btnSignout.onclick = async () => { await auth.signOut(); };

auth.onAuthStateChanged(async (u) => {
  currentUser = u;
  if (u) {
    userDisplay.innerText = u.displayName || u.email;
    btnSignin.style.display='none'; btnSignout.style.display='inline-block';
    document.getElementById('app').style.display='grid';
    // ensure user record exists
    const userRef = db.ref('users/' + u.uid);
    const snap = await userRef.get();
    if (!snap.exists()) {
      await userRef.set({ role: 'player', pfp: '', displayName: u.displayName || u.email });
    }
    // show session state if any
  } else {
    userDisplay.innerText = 'Not signed in';
    btnSignin.style.display='inline-block'; btnSignout.style.display='none';
    document.getElementById('app').style.display='none';
  }
});

// ---------- Session create / join ----------
btnCreateSession.onclick = async () => {
  const sid = 's_' + Math.random().toString(36).slice(2,9);
  sessionIdInput.value = sid;
  await createOrOpenSession(sid, true);
};
btnJoinSession.onclick = async () => {
  const sid = sessionIdInput.value.trim();
  if (!sid) return alert('enter session id');
  await createOrOpenSession(sid, false);
};

async function createOrOpenSession(sid, makeOwner=false) {
  sessionId = sid;
  sessionRef = db.ref('sessions/' + sessionId);
  sessionTitle.innerText = sessionId;
  sessionInfo.innerText = 'Loading session...';

  // if session doesn't exist and makeOwner -> create and set owner
  const snap = await sessionRef.get();
  if (!snap.exists()) {
    if (!makeOwner) {
      // create lightweight session record so players can join (no owner)
      await sessionRef.set({ created: Date.now(), createdBy: currentUser?currentUser.uid:'anon' });
    } else {
      await sessionRef.set({ created: Date.now(), ownerUid: currentUser.uid, createdBy: currentUser.uid });
    }
  }
  // add user to session users list
  if (currentUser) {
    await sessionRef.child('users/' + currentUser.uid).set({ joinedAt: Date.now(), displayName: currentUser.displayName || currentUser.email });
  }

  // read role: owner or check session users
  const sdata = (await sessionRef.get()).val() || {};
  if (sdata.ownerUid && currentUser && sdata.ownerUid === currentUser.uid) currentRole = 'dm';
  else {
    // check session's users mapping for a role field
    const uRoleSnap = await db.ref('sessions/' + sessionId + '/users/' + (currentUser ? currentUser.uid : 'none') + '/role').get();
    if (uRoleSnap.exists()) currentRole = uRoleSnap.val();
    else currentRole = 'player';
  }

  updateRoleUI();
  subscribeSessionRealtime();
  sessionInfo.innerText = 'Session loaded';
}

function updateRoleUI(){
  document.getElementById('session-info').innerText = `You are: ${currentRole}`;
  if (currentRole === 'dm') dmTools.style.display = 'block';
  else dmTools.style.display = 'none';
}

// ---------- Realtime listeners ----------
function subscribeSessionRealtime(){
  if (!sessionRef) return;
  // map
  sessionRef.child('map').on('value', snap => {
    const m = snap.val();
    if (m && m.url) loadMapIntoCanvas(m.url);
  });
  // tokens
  sessionRef.child('tokens').on('value', snap => {
    tokens = snap.val() || {};
    renderAll();
    tokensInfo.innerText = `Tokens: ${Object.keys(tokens).length}`;
    renderPlayersList();
  });
  // chat
  sessionRef.child('chat').limitToLast(200).on('value', snap => {
    const msgs = snap.val() || {};
    chatLog.innerHTML = '';
    Object.values(msgs).forEach(m => appendChatMessage(m));
  });
  // notes
  sessionRef.child('notes').on('value', snap => {
    sessionNotes.value = snap.val() || '';
  });
  // initiative
  sessionRef.child('initiative').on('value', snap => {
    initiative = Object.values(snap.val() || {});
    renderInitiative();
  });
  // encounters
  sessionRef.child('encounters').on('value', snap => {
    // not used heavily in demo
  });
  // characters
  sessionRef.child('characters').on('value', snap => {
    // display character list
    const chars = snap.val() || {};
    charactersList.innerHTML = '';
    Object.values(chars).forEach(c => {
      const el = document.createElement('div');
      el.className = 'muted';
      el.innerText = `${c.name} (${c.class})`;
      charactersList.appendChild(el);
    });
  });
}

// ---------- Map upload & load ----------
mapUpload.addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  // preview locally first
  const url = URL.createObjectURL(file);
  await loadMapIntoCanvas(url);
  // upload to Firebase Storage
  if (sessionRef) {
    const path = `sessions/${sessionId}/maps/${Date.now()}_${file.name}`;
    const storageRef = storage.ref(path);
    const snap = await storageRef.put(file);
    const publicUrl = await snap.ref.getDownloadURL();
    await sessionRef.child('map').set({ url: publicUrl, name: file.name, ts: Date.now() });
  } else {
    alert('Join or create a session first to save map to session');
  }
});

async function loadMapIntoCanvas(url){
  const img = new Image();
  img.src = url;
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  // resize canvas to match map resolution (fit width if too big)
  const maxW = Math.min(img.width, 2000);
  const maxH = Math.min(img.height, 1400);
  mapCanvas.width = img.width;
  mapCanvas.height = img.height;
  mapCanvas.style.width = img.width + 'px';
  mapCanvas.style.height = img.height + 'px';
  overlayFog.style.width = mapCanvas.style.width;
  overlayFog.style.height = mapCanvas.style.height;

  // store image in memory for redraws
  mapCanvas._bgImg = img;
  renderAll();
}

// ---------- Render tokens & fog ----------
function renderAll(){
  // clear
  ctx.clearRect(0,0,mapCanvas.width,mapCanvas.height);
  // draw bg
  if (mapCanvas._bgImg) ctx.drawImage(mapCanvas._bgImg, 0,0,mapCanvas.width,mapCanvas.height);
  // draw tokens
  Object.entries(tokens).forEach(([id,t]) => {
    drawToken(id,t);
  });
  // draw fog overlay if enabled (simple approach)
  if (fogEnabled || showFog) drawFog();
}

function drawToken(id, t){
  // draw token image if available else simple circle
  const x = t.x||100, y = t.y||100;
  const size = t.size || 48;
  if (t.pfp) {
    const img = new Image();
    img.src = t.pfp;
    img.onload = () => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, size/2, 0, Math.PI*2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, x-size/2, y-size/2, size, size);
      ctx.restore();
      drawHpBar(x, y+size/2 + 8, t.hp || 10, t.maxHp || 10);
    };
    // if image cached: draw immediate fallback small circle
  } else {
    ctx.beginPath();
    ctx.fillStyle = t.color || '#7c3aed';
    ctx.arc(x, y, 24, 0, Math.PI*2);
    ctx.fill();
    drawHpBar(x, y+28, t.hp||10, t.maxHp||10);
  }
}

function drawHpBar(x,y,hp,maxHp){
  const w = 40;
  const pct = Math.max(0, Math.min(1, hp/maxHp));
  ctx.fillStyle = '#333'; ctx.fillRect(x - w/2, y, w, 6);
  ctx.fillStyle = pct > 0.5 ? '#10b981' : (pct > 0.2 ? '#f59e0b' : '#ef4444');
  ctx.fillRect(x - w/2, y, w * pct, 6);
}

// basic fog: draw full dark rectangle and cut circular reveal around each token
function drawFog(){
  overlayFog.innerHTML = '';
  const fog = document.createElement('canvas');
  fog.width = mapCanvas.width;
  fog.height = mapCanvas.height;
  fog.style.width = mapCanvas.style.width;
  fog.style.height = mapCanvas.style.height;
  const fctx = fog.getContext('2d');
  fctx.fillStyle = 'rgba(0,0,0,0.7)';
  fctx.fillRect(0,0,fog.width,fog.height);
  // reveal circles where tokens are or DM-set reveals
  Object.values(tokens).forEach(t => {
    const rx = t.revealRadius || 120;
    fctx.globalCompositeOperation = 'destination-out';
    fctx.beginPath(); fctx.arc(t.x || 100, t.y || 100, rx, 0, Math.PI*2); fctx.fill();
    fctx.globalCompositeOperation = 'source-over';
  });
  overlayFog.appendChild(fog);
}

// ---------- Token placement / drag / edit ----------
mapCanvas.addEventListener('mousedown', mdown);
let dragState = null;
function mdown(e){
  const rect = mapCanvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (mapCanvas.width / rect.width);
  const y = (e.clientY - rect.top) * (mapCanvas.height / rect.height);

  // if clicking on a token select it else place token if user clicked Place My Token mode
  const hit = findTokenAt(x,y);
  if (hit) {
    // start drag if permission
    const tokenOwner = hit[1].owner;
    const canMove = (currentRole === 'dm') || (currentUser && tokenOwner === currentUser.uid);
    if (!canMove && !e.shiftKey) { return; } // locked
    dragState = { id: hit[0], offsetX: x - hit[1].x, offsetY: y - hit[1].y };
    document.addEventListener('mousemove', mmove);
    document.addEventListener('mouseup', mup);
    return;
  } else {
    // place a token at location if btnPlaceToken mode active
    if (placingTokenMode) {
      placeMyTokenAt(x,y);
    }
  }
}
function mmove(e){
  if (!dragState) return;
  const rect = mapCanvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (mapCanvas.width / rect.width);
  const y = (e.clientY - rect.top) * (mapCanvas.height / rect.height);
  const nx = gridSnap ? Math.round(x/32)*32 : x;
  const ny = gridSnap ? Math.round(y/32)*32 : y;
  // optimistic local render
  tokens[dragState.id].x = nx; tokens[dragState.id].y = ny;
  renderAll();
}
function mup(){
  if (!dragState) return;
  // commit to DB
  const id = dragState.id;
  const t = tokens[id];
  sessionRef.child('tokens/' + id).update({ x: t.x, y: t.y });
  dragState = null;
  document.removeEventListener('mousemove', mmove);
  document.removeEventListener('mouseup', mup);
}
function findTokenAt(x,y){
  for (const [id,t] of Object.entries(tokens)){
    const dx = t.x - x, dy = t.y - y;
    if (Math.sqrt(dx*dx + dy*dy) < (t.size||48)/2 ) return [id,t];
  }
  return null;
}

let placingTokenMode = false;
btnPlaceToken.onclick = () => {
  placingTokenMode = !placingTokenMode;
  btnPlaceToken.innerText = placingTokenMode ? 'Placing: Click map to place' : 'Place My Token';
};

// place player's token at clicked coords
async function placeMyTokenAt(x,y){
  if (!currentUser) return alert('Sign in first');
  // choose or upload pfp
  const userPfpSnap = await db.ref('users/' + currentUser.uid + '/pfp').get();
  const pfp = userPfpSnap.exists() ? userPfpSnap.val() : '';
  const id = sessionRef.child('tokens').push().key;
  const data = { id, owner: currentUser.uid, x, y, pfp, hp: 10, maxHp: 10, size: 48, revealRadius: 120 };
  await sessionRef.child('tokens/' + id).set(data);
  placingTokenMode = false;
  btnPlaceToken.innerText = 'Place My Token';
}

// upload profile picture
btnUploadPfp.onclick = () => filePfp.click();
filePfp.onchange = async (ev) => {
  const f = ev.target.files[0];
  if (!f) return;
  const path = `users/${currentUser.uid}/pfp_${Date.now()}_${f.name}`;
  const sref = storage.ref(path);
  const snap = await sref.put(f);
  const url = await snap.ref.getDownloadURL();
  await db.ref('users/' + currentUser.uid + '/pfp').set(url);
  alert('Profile picture saved');
};

// token add/remove/edit - DM tools
document.getElementById('btn-spawn-enc').onclick = async () => {
  const name = document.getElementById('enc-name').value || 'Encounter';
  const monsters = (document.getElementById('enc-list').value || '').split(',').map(s => s.trim()).filter(Boolean);
  const id = sessionRef.child('encounters').push().key;
  await sessionRef.child('encounters/' + id).set({ id, name, monsters, ts: Date.now() });
  alert('Encounter spawned');
};

function renderPlayersList(){
  playersList.innerHTML = '';
  sessionRef.child('users').get().then(snap => {
    const obj = snap.val() || {};
    Object.entries(obj).forEach(([uid,u]) => {
      const div = document.createElement('div');
      div.className = 'muted';
      div.innerText = `${u.displayName || uidShort(uid)} (${u.role || 'player'})`;
      playersList.appendChild(div);
    });
  });
}

// ---------- Chat ----------
chatSend.onclick = async () => {
  const text = chatIn.value.trim(); if (!text || !sessionRef) return;
  const id = sessionRef.child('chat').push().key;
  await sessionRef.child('chat/' + id).set({ id, uid: currentUser?currentUser.uid:'anon', user: currentUser?currentUser.displayName || currentUser.email:'anon', text, ts: Date.now() });
  chatIn.value = '';
};
function appendChatMessage(m){
  const el = document.createElement('div');
  el.innerHTML = `<strong>${m.user}:</strong> ${m.text} <div class="muted small">${new Date(m.ts).toLocaleTimeString()}</div>`;
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
}

// ---------- Notes ----------
btnSaveNotes.onclick = async () => {
  if (!sessionRef) return alert('Join session first');
  await sessionRef.child('notes').set(sessionNotes.value);
  alert('Notes saved');
};

// ---------- Initiative / Turn tracker ----------
document.getElementById('btn-add-ini').onclick = async () => {
  const name = document.getElementById('ini-name').value || 'Anon';
  const val = Number(document.getElementById('ini-val').value) || 0;
  const id = sessionRef.child('initiative').push().key;
  await sessionRef.child('initiative/' + id).set({ id, name, value: val, ts: Date.now() });
};
function renderInitiative(){
  const list = document.getElementById('initiative-list');
  list.innerHTML = '';
  initiative.sort((a,b)=>b.value - a.value).forEach((it,i)=>{
    const row = document.createElement('div');
    row.innerText = `${i+1}. ${it.name} — ${it.value}`;
    list.appendChild(row);
  });
  // current turn display
  const ct = document.getElementById('current-turn');
  ct.innerText = initiative.length ? `${initiative[turnIndex] ? initiative[turnIndex].name : 'none'}` : 'No initiative';
}
document.getElementById('btn-next-turn').onclick = () => {
  if (initiative.length === 0) return;
  turnIndex = (turnIndex + 1) % initiative.length;
  sessionRef.child('meta/turnIndex').set(turnIndex);
};
document.getElementById('btn-prev-turn').onclick = () => {
  if (initiative.length === 0) return;
  turnIndex = (turnIndex - 1 + initiative.length) % initiative.length;
  sessionRef.child('meta/turnIndex').set(turnIndex);
};

// listen for meta updates
if (typeof window !== 'undefined') {
  // subscribe meta changes
  const unsubMeta = () => {};
}
async function subscribeMeta(){
  sessionRef.child('meta/turnIndex').on('value', snap => {
    turnIndex = snap.val() || 0;
    renderInitiative();
  });
}

// ---------- Dice ----------
function rollPure(max){ return Math.floor(Math.random()*max)+1; }
document.querySelectorAll('.dice').forEach(b => b.onclick = () => {
  const sides = Number(b.dataset.sides);
  const r = rollPure(sides);
  logDice(`1d${sides}: ${r}`);
});
document.getElementById('adv-btn').onclick = () => {
  const a = rollPure(20), b = rollPure(20);
  logDice(`Adv: ${a} / ${b} -> ${Math.max(a,b)}`);
};
document.getElementById('dis-btn').onclick = () => {
  const a = rollPure(20), b = rollPure(20);
  logDice(`Dis: ${a} / ${b} -> ${Math.min(a,b)}`);
};
function logDice(text){
  const el = document.getElementById('dice-log');
  const row = document.createElement('div'); row.innerText = `${new Date().toLocaleTimeString()} — ${text}`;
  el.prepend(row);
  // optional: save to session rolls
  const id = sessionRef.child('rolls').push().key;
  sessionRef.child('rolls/' + id).set({ id, text, user: currentUser?currentUser.displayName:'anon', ts: Date.now() });
}

// ---------- Characters local & session ----------
btnNewCharacter.onclick = () => {
  const id = randId('char');
  const ch = { id, name: 'New Hero', class: 'Fighter', stats: {STR:12,DEX:12,CON:12,INT:10,WIS:10,CHA:10}, owner: currentUser?currentUser.uid:'local' };
  localCharacters[id] = ch;
  renderLocalCharacters();
  // optionally push to session characters (owner or DM)
  if (sessionRef && currentRole === 'dm') {
    sessionRef.child('characters/' + id).set(ch);
  }
};
function renderLocalCharacters(){
  charactersList.innerHTML = '';
  Object.values(localCharacters).forEach(ch => {
    const div = document.createElement('div');
    div.className = 'muted';
    div.innerText = `${ch.name} (${ch.class})`;
    charactersList.appendChild(div);
  });
}

// ---------- Export / Import session
document.getElementById('btn-export-session').onclick = async () => {
  if (!sessionRef) return alert('Join session first');
  const snap = await sessionRef.get();
  const blob = new Blob([JSON.stringify(snap.val()||{},null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `${sessionId}_export.json`; a.click(); URL.revokeObjectURL(url);
};

// ---------- Session save helpers
// Save tokens automatically happens on move commit (we update token child). Add helper to create token
async function createToken(data){
  if (!sessionRef) throw new Error('no session');
  const id = sessionRef.child('tokens').push().key;
  data.id = id;
  await sessionRef.child('tokens/' + id).set(data);
  return id;
}

// ---------- Init / helpers
document.getElementById('btn-save-map').onclick = async () => {
  if (!sessionRef || !mapCanvas._bgImg) return alert('no session or no map loaded');
  // already uploaded when map upload used; this button can re-sync existing preview by saving a placeholder
  const url = mapCanvas._bgImg.src;
  await sessionRef.child('map').set({ url, ts: Date.now() });
  alert('Map saved to session');
};

document.getElementById('grid-snap').addEventListener('change', (e) => gridSnap = e.target.checked);
document.getElementById('show-fog').addEventListener('change', (e) => { fogEnabled = e.target.checked; renderAll(); });
document.getElementById('fog-visible').addEventListener('change', (e)=> { showFog = e.target.checked; renderAll(); });

// when session selected, subscribe meta
async function postSessionInit(){
  if (!sessionRef) return;
  subscribeMeta();
  // set up simple listeners handled in subscribeSessionRealtime
}

// small interaction: place token by clicking map while in place mode is handled earlier

// when page unload leave session users mapping
window.addEventListener('beforeunload', async () => {
  if (sessionRef && currentUser) {
    await sessionRef.child('users/' + currentUser.uid).remove();
  }
});

// small start: expose sessionRef globally for debug
window.__LF = { db, storage, auth, sessionRef: () => sessionRef };

// end of file
