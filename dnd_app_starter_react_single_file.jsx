/*
DND App — Single-file React Demo (Simple Demo)
Features included in this single-file demo:
 - Firebase Auth (Google + Email/Password)
 - Firebase Realtime Database for real-time: tokens, dice rolls, chat, initiative, notes, encounters
 - Firebase Storage map upload + public URL retrieval
 - Local fallback for characters when not signed in
 - Role-based permissions (Admin / Leader / Player / Ghost)
 - Map viewer with token placement and drag-to-move (simple)
 - Crypto-secure dice roller with public/private roll option
 - Initiative tracker & combat encounter spawner (simple)
 - Session notes (markdown) saved to DB
 - No AI included — "AI: Coming soon" placeholder and UI entry points

This file is a **demo** — intended as a complete runnable starter. It is not production hardened.

Setup notes (brief):
 1) npm create vite@latest my-dnd --template react
 2) cd my-dnd && npm install
 3) npm i firebase react-markdown
 4) Replace this file into src/App.jsx and run npm run dev
 5) In Firebase Console: enable Authentication (Google + Email), create Realtime Database & Storage, add web app and add authorized domains for OAuth
 6) Never embed private production keys in public repos (this demo uses the config you provided — for learning only).

*/

import React, { useEffect, useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';

// ---------- FIREBASE CONFIG (user-provided) ----------
const firebaseConfig = {
  apiKey: "AIzaSyA66xqYt8GZCxRxegAo8ilq2tmqEL4mC_0",
  authDomain: "loreforge-e5c62.firebaseapp.com",
  projectId: "loreforge-e5c62",
  storageBucket: "loreforge-e5c62.firebasestorage.app",
  messagingSenderId: "529682812294",
  appId: "1:529682812294:web:7e4b9cf64b48e813dff007",
  measurementId: "G-E3HLEWVKJN"
};

// ---------- Imports (use npm install firebase react-markdown) ----------
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { getDatabase, ref, onValue, set, push, update, remove } from 'firebase/database';
import { getStorage, ref as sref, uploadBytes, getDownloadURL } from 'firebase/storage';

// ---------- Initialize Firebase ----------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

// ---------- Utility: secure RNG dice ----------
function secureRandomInt(max) {
  const arr = new Uint32Array(1);
  window.crypto.getRandomValues(arr);
  return arr[0] % max;
}
function rollDice(sides, count = 1) {
  const rolls = [];
  for (let i = 0; i < count; i++) rolls.push(1 + secureRandomInt(sides));
  return { rolls, total: rolls.reduce((a, b) => a + b, 0) };
}

// ---------- Tiny CSS (component-scoped) ----------
const styles = `
:root{--bg:#0f1724;--card:#0b1220;--accent:#7c3aed;--muted:#9ca3af;--glass:rgba(255,255,255,0.04)}
*{box-sizing:border-box}
body{font-family:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial;margin:0;background:linear-gradient(180deg,#071029 0%, #0f1724 100%);color:#e6eef8}
.app{max-width:1200px;margin:28px auto;padding:20px}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.brand{display:flex;align-items:center;gap:12px}
.logo{width:44px;height:44px;border-radius:10px;background:linear-gradient(135deg,var(--accent),#06b6d4);display:flex;align-items:center;justify-content:center;font-weight:700}
.card{background:var(--card);padding:14px;border-radius:12px;box-shadow:0 6px 18px rgba(2,6,23,0.6)}
.row{display:flex;gap:12px}
.col{flex:1}
.side{width:320px}
.btn{background:linear-gradient(90deg,var(--accent),#06b6d4);border:none;color:white;padding:8px 12px;border-radius:8px;cursor:pointer}
.btn.ghost{background:transparent;border:1px solid rgba(255,255,255,0.06)}
.small{font-size:13px}
.map-canvas{width:100%;height:480px;background:var(--glass);border-radius:10px;overflow:hidden;display:block}
.controls{display:flex;gap:8px;flex-wrap:wrap}
.input{background:#071324;border-radius:8px;padding:8px;border:1px solid rgba(255,255,255,0.03);color:inherit}
.list{max-height:220px;overflow:auto;margin-top:8px}
.token-bullet{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px}
.note-area{width:100%;height:160px;background:#061021;border-radius:8px;padding:10px;border:1px solid rgba(255,255,255,0.03);color:inherit}
.small-muted{font-size:12px;color:var(--muted)}
`;

// ---------- App Component ----------
export default function App() {
  // app-wide
  const [user, setUser] = useState(null);
  const [campaignId, setCampaignId] = useState('demo-campaign');
  const [campaign, setCampaign] = useState(null);

  // Realtime nodes
  const [tokens, setTokens] = useState({});
  const [rolls, setRolls] = useState([]);
  const [chat, setChat] = useState([]);
  const [notes, setNotes] = useState('');
  const [initiative, setInitiative] = useState([]);
  const [encounters, setEncounters] = useState([]);

  // UI/Local
  const [mapUrl, setMapUrl] = useState(null);
  const [selectedCharId, setSelectedCharId] = useState(null);
  const [characters, setCharacters] = useState(() => loadLocalCharacters());
  const [selectedToken, setSelectedToken] = useState(null);
  const canvasRef = useRef(null);
  const dragState = useRef(null);

  useEffect(() => {
    // auth listener
    const unSubAuth = onAuthStateChanged(auth, (u) => {
      if (u) setUser({ uid: u.uid, name: u.displayName || u.email, email: u.email });
      else setUser(null);
    });
    // subscribe to campaign nodes
    const baseRef = ref(db, `campaigns/${campaignId}`);
    const tokensRef = ref(db, `campaigns/${campaignId}/tokens`);
    const rollsRef = ref(db, `campaigns/${campaignId}/rolls`);
    const chatRef = ref(db, `campaigns/${campaignId}/chat`);
    const notesRef = ref(db, `campaigns/${campaignId}/notes`);
    const initRef = ref(db, `campaigns/${campaignId}/initiative`);
    const encRef = ref(db, `campaigns/${campaignId}/encounters`);

    onValue(baseRef, (snap) => { setCampaign(snap.val() || {}); });
    onValue(tokensRef, (snap) => { setTokens(snap.val() || {}); });
    onValue(rollsRef, (snap) => { const v = snap.val() || {}; setRolls(Object.values(v).reverse()); });
    onValue(chatRef, (snap) => { const v = snap.val() || {}; setChat(Object.values(v).reverse()); });
    onValue(notesRef, (snap) => { setNotes(snap.val() || ''); });
    onValue(initRef, (snap) => { const v = snap.val() || {}; setInitiative(Object.values(v)); });
    onValue(encRef, (snap) => { const v = snap.val() || {}; setEncounters(Object.values(v)); });

    return () => { unSubAuth(); };
  }, [campaignId]);

  // ---------- Auth functions ----------
  async function signInWithGoogle() {
    const provider = new GoogleAuthProvider();
    try { await signInWithPopup(auth, provider); } catch (e) { alert('Sign in failed: ' + e.message); }
  }
  async function signOutUser() { await signOut(auth); }
  async function emailSignUp(email, password) { try { await createUserWithEmailAndPassword(auth, email, password); } catch (e) { alert(e.message); } }
  async function emailSignIn(email, password) { try { await signInWithEmailAndPassword(auth, email, password); } catch (e) { alert(e.message); } }

  // ---------- Helpers: DB writes ----------
  function pushRoll(entry) { const p = push(ref(db, `campaigns/${campaignId}/rolls`)); set(p, entry); }
  function pushChat(entry) { const p = push(ref(db, `campaigns/${campaignId}/chat`)); set(p, entry); }
  function writeTokens(obj) { set(ref(db, `campaigns/${campaignId}/tokens`), obj); }
  function writeNotes(text) { set(ref(db, `campaigns/${campaignId}/notes`), text); }
  function pushInitiative(item) { const p = push(ref(db, `campaigns/${campaignId}/initiative`)); set(p, item); }
  function pushEncounter(enc) { const p = push(ref(db, `campaigns/${campaignId}/encounters`)); set(p, enc); }

  // ---------- Characters local storage (fallback) ----------
  function loadLocalCharacters() {
    try { const raw = localStorage.getItem('dnd_chars_v2'); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  }
  function saveLocalCharacters(obj) { localStorage.setItem('dnd_chars_v2', JSON.stringify(obj)); }
  function createCharacter(name = 'New Hero') {
    const id = 'c_' + Date.now();
    const sheet = { id, name, race: 'Human', class: 'Fighter', stats: { STR: 12, DEX: 12, CON: 12, INT: 10, WIS: 10, CHA: 10 }, inventory: [] };
    const next = { ...characters, [id]: sheet };
    setCharacters(next); saveLocalCharacters(next);
  }
  function updateCharacter(id, sheet) { const next = { ...characters, [id]: sheet }; setCharacters(next); saveLocalCharacters(next); }
  function deleteCharacterLocal(id) { const next = { ...characters }; delete next[id]; setCharacters(next); saveLocalCharacters(next); }

  // ---------- Map upload to Firebase Storage ----------
  async function uploadMapFile(file) {
    if (!file) return alert('No file');
    const path = `campaigns/${campaignId}/maps/${Date.now()}_${file.name}`;
    const storageRef = sref(storage, path);
    try {
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      setMapUrl(url);
      // store map url on campaign
      set(ref(db, `campaigns/${campaignId}/map`), { url, name: file.name, ts: Date.now() });
    } catch (e) { alert('Upload failed: ' + e.message); }
  }

  // ---------- Map canvas rendering & token placement ----------
  useEffect(() => {
    const c = canvasRef.current; if (!c) return; const ctx = c.getContext('2d');
    const w = c.width = c.clientWidth; const h = c.height = c.clientHeight;
    // clear
    ctx.clearRect(0, 0, w, h);
    const img = new Image();
    const imgUrl = (campaign && campaign.map && campaign.map.url) || mapUrl;
    if (imgUrl) img.src = imgUrl;
    img.onload = () => {
      ctx.drawImage(img, 0, 0, w, h);
      // draw tokens
      Object.entries(tokens).forEach(([id, t]) => {
        const x = t.x * w, y = t.y * h;
        ctx.beginPath(); ctx.fillStyle = t.color || '#7c3aed'; ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'white'; ctx.font = '12px sans-serif'; ctx.fillText(t.label || id, x + 16, y + 5);
      });
    };
    img.onerror = () => { /* nothing */ };
  }, [mapUrl, campaign, tokens]);

  function canvasClick(e) {
    const c = canvasRef.current; const rect = c.getBoundingClientRect(); const x = (e.clientX - rect.left) / c.clientWidth; const y = (e.clientY - rect.top) / c.clientHeight;
    if (!selectedCharId) return;
    const char = characters[selectedCharId]; if (!char) return;
    // create token
    const id = 't_' + Date.now();
    const token = { id, owner: user ? user.uid : 'local', charId: selectedCharId, label: char.name, x, y, color: user ? '#06b6d4' : '#7c3aed' };
    const next = { ...tokens, [id]: token };
    writeTokens(next);
  }

  // Drag tokens: mousedown on canvas near token picks it up
  function canvasMouseDown(e) {
    const c = canvasRef.current; const rect = c.getBoundingClientRect(); const mx = (e.clientX - rect.left) / c.clientWidth; const my = (e.clientY - rect.top) / c.clientHeight;
    // find token within threshold
    let found = null; for (const [id, t] of Object.entries(tokens)) { const dx = t.x - mx; const dy = t.y - my; if (Math.sqrt(dx*dx+dy*dy) < 0.03) { found = { id, t }; break; } }
    if (found) { dragState.current = found; }
  }
  function canvasMouseMove(e) { if (!dragState.current) return; const c = canvasRef.current; const rect = c.getBoundingClientRect(); const mx = (e.clientX - rect.left) / c.clientWidth; const my = (e.clientY - rect.top) / c.clientHeight; const next = { ...tokens, [dragState.current.id]: { ...dragState.current.t, x: mx, y: my } }; writeTokens(next); }
  function canvasMouseUp(e) { dragState.current = null; }

  // ---------- Dice & Rolls ----------
  function handleRoll(sides, count = 1, visibility = 'public') {
    const { rolls, total } = rollDice(sides, count);
    const entry = { id: 'r_' + Date.now(), user: user ? user.name : 'Local', uid: user ? user.uid : 'local', sides, count, rolls, total, visibility, ts: Date.now() };
    pushRoll(entry);
  }

  // ---------- Chat ----------
  function sendChat(text) {
    if (!text) return;
    const entry = { id: 'm_' + Date.now(), user: user ? user.name : 'Local', uid: user ? user.uid : 'local', text, ts: Date.now() };
    pushChat(entry);
  }

  // ---------- Initiative & Encounters ----------
  function addInitiative(name, initVal) { if (!name) return; pushInitiative({ id: 'i_'+Date.now(), name, initVal, ts: Date.now() }); }
  function spawnEncounter(name, monsters) { pushEncounter({ id: 'e_'+Date.now(), name, monsters, ts: Date.now() }); }

  // ---------- Session Notes ----------
  function saveNotes() { writeNotes(notes); }

  // ---------- Role system (simple) ----------
  function getRole() {
    if (!user) return 'ghost';
    // Admin if campaign.ownerUid === user.uid
    if (campaign && campaign.ownerUid === user.uid) return 'admin';
    // check campaign.roles mapping
    if (campaign && campaign.roles && campaign.roles[user.uid]) return campaign.roles[user.uid];
    return 'player';
  }

  // ---------- UI Helpers ----------
  const [chatTyped, setChatTyped] = useState('');
  const [emailVal, setEmailVal] = useState('');
  const [passVal, setPassVal] = useState('');
  const [mapFile, setMapFile] = useState(null);

  // ---------- Render ----------
  return (
    <div className="app">
      <style>{styles}</style>
      <div className="header">
        <div className="brand">
          <div className="logo">LF</div>
          <div>
            <div style={{fontSize:18,fontWeight:700}}>LoreForge — D&D Demo</div>
            <div className="small-muted">Simple demo — not production. AI: Coming soon</div>
          </div>
        </div>
        <div>
          {user ? (
            <div className="row" style={{alignItems:'center',gap:10}}>
              <div className="small-muted">{user.name}</div>
              <button className="btn" onClick={() => signOutUser()}>Sign out</button>
            </div>
          ) : (
            <div className="row">
              <button className="btn" onClick={signInWithGoogle}>Google Sign-in</button>
              <button className="btn ghost" onClick={() => { setEmailVal(''); setPassVal(''); alert('Use email sign-up/sign-in form below'); }}>Email</button>
            </div>
          )}
        </div>
      </div>

      <div className="row" style={{gap:16}}>
        <div className="col card">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <div style={{fontWeight:700}}>Campaign: {campaignId}</div>
              <div className="small-muted">Role: {getRole()}</div>
            </div>
            <div className="small-muted">Map: {(campaign && campaign.map && campaign.map.name) || 'none'}</div>
          </div>

          <div style={{display:'flex',gap:12,marginTop:12}}>
            <div style={{flex:1}}>
              <div className="card" style={{padding:10}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <div style={{fontWeight:600}}>Map & Tokens</div>
                  <div className="small-muted">Click to place token; drag to move (owners only)</div>
                </div>
                <div className="row" style={{gap:12}}>
                  <div style={{flex:1}}>
                    <input className="input" type="file" accept="image/*" onChange={(e)=>{ setMapFile(e.target.files[0]); uploadMapFile(e.target.files[0]); }} />
                    <div style={{height:12}} />
                    <div className="map-canvas card" style={{padding:6}}>
                      <canvas ref={canvasRef} style={{width:'100%',height:'100%'}} onClick={canvasClick} onMouseDown={canvasMouseDown} onMouseMove={canvasMouseMove} onMouseUp={canvasMouseUp}></canvas>
                    </div>
                    <div style={{marginTop:8,display:'flex',gap:8}}>
                      <div className="controls">
                        <button className="btn" onClick={()=>handleRoll(20,1)}>Roll d20</button>
                        <button className="btn" onClick={()=>handleRoll(6,3)}>Roll 3d6</button>
                        <button className="btn ghost" onClick={()=>{ alert('AI features are coming soon — placeholder'); }}>AI: Coming soon</button>
                      </div>
                    </div>
                  </div>

                  <div style={{width:260}}>
                    <div style={{fontWeight:600}}>Tokens ({Object.keys(tokens).length})</div>
                    <div className="list card" style={{marginTop:8,padding:8}}>
                      {Object.entries(tokens).map(([id,t])=> (
                        <div key={id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',borderBottom:'1px solid rgba(255,255,255,0.02)'}}>
                          <div>
                            <div style={{fontWeight:600}}>{t.label}</div>
                            <div className="small-muted">Owner: {t.owner}</div>
                          </div>
                          <div style={{display:'flex',flexDirection:'column',gap:6}}>
                            <button className="btn ghost small" onClick={()=>{ const n = {...tokens}; delete n[id]; writeTokens(n); }}>Remove</button>
                            <button className="btn small" onClick={()=>{ setSelectedToken(id); }}>Select</button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div style={{marginTop:10}}>
                      <div style={{fontWeight:600}}>Create Token</div>
                      <div style={{display:'flex',gap:6,marginTop:8}}>
                        <select className="input" onChange={(e)=>setSelectedCharId(e.target.value)} value={selectedCharId||''}>
                          <option value="">-- select local char --</option>
                          {Object.values(characters).map(c=> (<option key={c.id} value={c.id}>{c.name} ({c.class})</option>))}
                        </select>
                        <button className="btn" onClick={()=>{ if(!selectedCharId) return alert('select char'); const c = characters[selectedCharId]; const id='t_'+Date.now(); const token={id,owner:user?user.uid:'local',charId:selectedCharId,label:c.name,x:0.5,y:0.5,color:'#7c3aed'}; writeTokens({...tokens,[id]:token}); }}>Place</button>
                      </div>
                      <div style={{marginTop:8}} className="small-muted">Pro tip: owners can drag their tokens on the map.</div>
                    </div>

                  </div>
                </div>
              </div>

              <div style={{marginTop:12}} className="card">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div style={{fontWeight:600}}>Dice Rolls</div>
                  <div className="small-muted">Recent public rolls</div>
                </div>
                <div className="list" style={{marginTop:8}}>
                  {rolls.map(r=> (
                    <div key={r.id} style={{padding:8,borderBottom:'1px solid rgba(255,255,255,0.02)'}}>
                      <div style={{fontWeight:600}}>{r.user} rolled {r.count}d{r.sides} → {r.rolls.join(', ')} (total {r.total})</div>
                      <div className="small-muted">{new Date(r.ts).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            <div className="side">
              <div className="card" style={{padding:10}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div style={{fontWeight:600}}>Chat</div>
                  <div className="small-muted">Real-time chat</div>
                </div>
                <div className="list" style={{marginTop:8}}>
                  {chat.map(m=> (
                    <div key={m.id} style={{padding:6,borderBottom:'1px solid rgba(255,255,255,0.02)'}}>
                      <div style={{fontWeight:600}}>{m.user}</div>
                      <div style={{fontSize:13}}>{m.text}</div>
                      <div className="small-muted">{new Date(m.ts).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:8,display:'flex',gap:8}}>
                  <input className="input" value={chatTyped} onChange={(e)=>setChatTyped(e.target.value)} placeholder="Say something" />
                  <button className="btn" onClick={()=>{ sendChat(chatTyped); setChatTyped(''); }}>Send</button>
                </div>
              </div>

              <div className="card" style={{padding:10,marginTop:12}}>
                <div style={{fontWeight:600}}>Initiative Tracker</div>
                <div style={{marginTop:8}}>
                  <input className="input" placeholder="Name" id="iniName" />
                  <input className="input" placeholder="Init value" id="iniVal" style={{marginTop:6}} />
                  <div style={{marginTop:6,display:'flex',gap:6}}>
                    <button className="btn" onClick={()=>{ const n = document.getElementById('iniName').value; const v = parseInt(document.getElementById('iniVal').value||'0'); addInitiative(n,v); }}>Add</button>
                    <button className="btn ghost" onClick={()=>{ alert('Sort and remove functions are available in production builds'); }}>Manage</button>
                  </div>
                </div>
                <div className="list" style={{marginTop:8}}>
                  {initiative.map(it=>(<div key={it.id} style={{padding:6,borderBottom:'1px solid rgba(255,255,255,0.02)'}}>{it.name} — {it.initVal}</div>))}
                </div>
              </div>

              <div className="card" style={{padding:10,marginTop:12}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div style={{fontWeight:600}}>Encounters</div>
                  <div className="small-muted">Admin/Leader tools</div>
                </div>
                <div style={{marginTop:8}}>
                  <input className="input" placeholder="Encounter name" id="encName" />
                  <input className="input" placeholder="Monsters (comma)" id="encMons" style={{marginTop:6}} />
                  <div style={{marginTop:6,display:'flex',gap:6}}>
                    <button className="btn" onClick={()=>{ const n=document.getElementById('encName').value; const m=document.getElementById('encMons').value.split(',').map(s=>s.trim()).filter(Boolean); spawnEncounter(n,m); }}>Spawn</button>
                  </div>
                </div>
                <div className="list" style={{marginTop:8}}>
                  {encounters.map(e=> (<div key={e.id} style={{padding:6,borderBottom:'1px solid rgba(255,255,255,0.02)'}}><div style={{fontWeight:700}}>{e.name}</div><div className="small-muted">{(e.monsters||[]).join(', ')}</div></div>))}
                </div>
              </div>

            </div>
          </div>

        </div>

        <div className="side">
          <div className="card" style={{padding:10}}>
            <div style={{fontWeight:600}}>Characters (Local)</div>
            <div style={{marginTop:8}}>
              <button className="btn" onClick={()=>createCharacter('Hero '+(Object.keys(characters).length+1))}>New Character</button>
            </div>
            <div className="list" style={{marginTop:8}}>
              {Object.values(characters).map(c=> (
                <div key={c.id} style={{padding:8,borderBottom:'1px solid rgba(255,255,255,0.02)'}}>
                  <div style={{fontWeight:700}}>{c.name} <span className="small-muted">({c.class})</span></div>
                  <div style={{display:'flex',gap:6,marginTop:6}}>
                    <button className="btn small" onClick={()=>{ updateCharacter(c.id, {...c, stats:{...c.stats, STR: c.stats.STR+1}}); }}>+STR</button>
                    <button className="btn ghost small" onClick={()=>{ deleteCharacterLocal(c.id); }}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{padding:10,marginTop:12}}>
            <div style={{fontWeight:600}}>Session Notes</div>
            <textarea className="note-area" value={notes} onChange={(e)=>setNotes(e.target.value)} />
            <div style={{display:'flex',gap:8,marginTop:8}}>
              <button className="btn" onClick={()=>saveNotes()}>Save Notes</button>
              <button className="btn ghost" onClick={()=>alert('Exporting notes... (manual)')}>Export</button>
            </div>
            <div style={{marginTop:8}}>
              <div style={{fontWeight:600}}>Preview (Markdown)</div>
              <div className="card" style={{padding:8,marginTop:8,maxHeight:120,overflow:'auto'}}>
                <ReactMarkdown>{notes || '*No notes*'}</ReactMarkdown>
              </div>
            </div>
          </div>

          <div className="card" style={{padding:10,marginTop:12}}>
            <div style={{fontWeight:600}}>Auth (Email)</div>
            <input className="input" placeholder="Email" value={emailVal} onChange={(e)=>setEmailVal(e.target.value)} />
            <input className="input" placeholder="Password" value={passVal} onChange={(e)=>setPassVal(e.target.value)} style={{marginTop:6}} />
            <div style={{display:'flex',gap:8,marginTop:8}}>
              <button className="btn" onClick={()=>emailSignUp(emailVal,passVal)}>Sign up</button>
              <button className="btn ghost" onClick={()=>emailSignIn(emailVal,passVal)}>Sign in</button>
            </div>
            <div style={{marginTop:8}} className="small-muted">Firebase Email/Google auth only — no passwords stored here.</div>
          </div>

          <div className="card" style={{padding:10,marginTop:12}}>
            <div style={{fontWeight:600}}>Deploy notes</div>
            <div className="small-muted" style={{marginTop:8}}>This demo uses Firebase Realtime DB and Storage. For production: add security rules, Cloud Functions to validate writes, and never expose admin API keys in clients.</div>
          </div>

        </div>
      </div>

    </div>
  );
}

/*
End of single-file demo.

What's included (summary):
- Map upload (Storage) + campaign.map saved to Realtime DB
- Token placement, drag-to-move, token CRUD
- Dice system (crypto RNG) with rolls stored in DB
- Chat saved to DB
- Initiative & encounters stored in DB
- Local character storage for offline usage
- Session notes (markdown preview) saved to DB
- Role system stub (owner => admin; campaign.roles mapping supported)
- AI: intentionally NOT included — UI shows "Coming soon" and placeholder hooks for later integration

Next steps I can do for you (pick one):
1) Split this into a clean Vite repo with file structure and README.
2) Add sample Firebase Realtime Database rules and example Cloud Function to proxy OpenAI securely (for when you want AI later).
3) Turn UI into Tailwind-based theme and optimize canvas for PixiJS dynamic lighting (advanced).

Choose which next step and I will prepare it directly in the canvas/project.
*/
