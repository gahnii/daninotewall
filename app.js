const SOUND_STORE = "noteWallSound_v1";
let soundEnabled = (localStorage.getItem(SOUND_STORE) || "off") === "on";
let bgmStarted = false;
let bgmWanted = soundEnabled;

const SFX = {
  click: new Audio("./assets/click.mp3"),
  bgm:   new Audio("./assets/bgm.mp3"),
};

SFX.click.preload = "auto";
SFX.bgm.preload   = "auto";
SFX.bgm.loop = true;

SFX.click.volume = 0.55;
SFX.bgm.volume   = 0.25;

function updateSoundButton(){

  if(typeof btnSound === "undefined" || !btnSound) return;
  btnSound.textContent = soundEnabled ? "sound: on" : "sound: off";
  btnSound.classList.toggle("soundOn", soundEnabled);
  btnSound.classList.toggle("soundOff", !soundEnabled);
}

function playClick(){
  if(!soundEnabled) return;
  try{
    SFX.click.currentTime = 0;
    SFX.click.play().catch(()=>{});
  }catch{}
}

function bgmPlaySafe(){
  if(!soundEnabled || !bgmWanted) return;
  if(bgmStarted) return;
  const p = SFX.bgm.play();
  if(p && typeof p.then === "function"){
    p.then(()=>{ bgmStarted = true; }).catch(()=>{  });
  }
}

function bgmStop(){
  try{ SFX.bgm.pause(); }catch{}
  bgmStarted = false;
}

function setSound(on){
  soundEnabled = !!on;
  bgmWanted = soundEnabled;
  localStorage.setItem(SOUND_STORE, soundEnabled ? "on" : "off");
  updateSoundButton();

  if(!soundEnabled){
    bgmStop();
  }else{

    bgmPlaySafe();
  }
}

function installFirstGestureHook(){
  const unlock = () => {
    if(soundEnabled) bgmPlaySafe();
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
    window.removeEventListener("touchstart", unlock, true);
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
  window.addEventListener("touchstart", unlock, true);

  document.addEventListener("visibilitychange", () => {
    if(document.hidden){
      if(bgmStarted) bgmStop();
    }else{
      if(soundEnabled) bgmPlaySafe();
    }
  });
}

function installUiSounds(){
  const clickTargets = [
    btnNew, btnCenter, btnRefresh, btnSound,
    btnCloseDrawer, btnDelete, btnDone
  ].filter(Boolean);

  for(const el of clickTargets){
    el.addEventListener("click", playClick);
  }

  if(stage){
    stage.addEventListener("dblclick", () => playClick());
  }
}

const API_BASE = "/api";
const POLL_MS = 2000;
const SAVE_DEBOUNCE_MS = 450;

const STAGE_W = 3000;
const STAGE_H = 2000;

const GRID = 24;
const NOTE_W = 240;
const NOTE_H = 132;

const ENFORCE_NO_OVERLAP = true;

const stage = document.getElementById("stage");
const statusEl = document.getElementById("status");
const toastEl = document.getElementById("toast");

const btnNew = document.getElementById("btnNew");
const btnCenter = document.getElementById("btnCenter");
const btnRefresh = document.getElementById("btnRefresh");
const btnSound = document.getElementById("btnSound");

const drawer = document.getElementById("drawer");
const btnCloseDrawer = document.getElementById("btnCloseDrawer");
const editText = document.getElementById("editText");
const colorRow = document.getElementById("colorRow");
const btnDelete = document.getElementById("btnDelete");
const btnDone = document.getElementById("btnDone");
const metaId = document.getElementById("metaId");
const metaTime = document.getElementById("metaTime");
const metaPos = document.getElementById("metaPos");
const ownerTag = document.getElementById("ownerTag");

const COLORS = [
  { key: "note1", css: "var(--note1)" },
  { key: "note2", css: "var(--note2)" },
  { key: "note3", css: "var(--note3)" },
  { key: "note4", css: "var(--note4)" },
  { key: "note5", css: "var(--note5)" },
];

let notes = [];
let __mobileReadyAt = performance.now() + 700;
let noteEls = new Map();
let selectedId = null;
let selectedColor = "note1";
let apiOnline = false;

let pollTimer = null;
let saveTimer = null;

const KEY_STORE = "noteKeys_v1";
function loadKeys(){
  try{ return JSON.parse(localStorage.getItem(KEY_STORE) || "{}"); }
  catch{ return {}; }
}
function saveKeys(obj){
  localStorage.setItem(KEY_STORE, JSON.stringify(obj));
}
function getEditKey(noteId){
  const m = loadKeys();
  return m[noteId] || null;
}
function setEditKey(noteId, key){
  const m = loadKeys();
  m[noteId] = key;
  saveKeys(m);
}
function deleteEditKey(noteId){
  const m = loadKeys();
  delete m[noteId];
  saveKeys(m);
}
function isOwner(noteId){
  return !!getEditKey(noteId);
}

function uid(){
  return "n_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function randKey(){

  return "k_" + crypto.getRandomValues(new Uint32Array(4)).join("_") + "_" + Date.now().toString(16);
}
function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }
function nowISO(){ return new Date().toISOString(); }
function safeText(t){ return (t ?? "").toString(); }
function setStatus(t){ statusEl.textContent = t; }

function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(()=>toastEl.classList.remove("show"), 1400);
}

function noteBg(colorKey){
  const found = COLORS.find(c => c.key === colorKey);
  return found ? found.css : "var(--note1)";
}

function snap(n){
  return Math.round(n / GRID) * GRID;
}

function cellKeyFromXY(x,y){

  return `${snap(x)}:${snap(y)}`;
}

function buildOccupancy(exceptId=null){
  const occ = new Set();
  for(const n of notes){
    if(exceptId && n.id === exceptId) continue;
    occ.add(cellKeyFromXY(n.x, n.y));
  }
  return occ;
}

function findFreeCellNear(x,y, exceptId=null){

  const targetX = clamp(snap(x), 0, STAGE_W - NOTE_W);
  const targetY = clamp(snap(y), 0, STAGE_H - NOTE_H);

  if(!ENFORCE_NO_OVERLAP) return {x:targetX, y:targetY};

  const occ = buildOccupancy(exceptId);
  const maxR = 40;

  function isFree(px,py){
    const k = `${px}:${py}`;
    return !occ.has(k);
  }

  if(isFree(targetX,targetY)) return {x:targetX, y:targetY};

  for(let r=1; r<=maxR; r++){
    for(let dx=-r; dx<=r; dx++){
      const candidates = [
        {x: targetX + dx*GRID, y: targetY - r*GRID},
        {x: targetX + dx*GRID, y: targetY + r*GRID},
      ];
      for(const c of candidates){
        const px = clamp(c.x, 0, STAGE_W - NOTE_W);
        const py = clamp(c.y, 0, STAGE_H - NOTE_H);
        const sx = snap(px), sy = snap(py);
        if(isFree(sx,sy)) return {x:sx, y:sy};
      }
    }
    for(let dy=-r+1; dy<=r-1; dy++){
      const candidates = [
        {x: targetX - r*GRID, y: targetY + dy*GRID},
        {x: targetX + r*GRID, y: targetY + dy*GRID},
      ];
      for(const c of candidates){
        const px = clamp(c.x, 0, STAGE_W - NOTE_W);
        const py = clamp(c.y, 0, STAGE_H - NOTE_H);
        const sx = snap(px), sy = snap(py);
        if(isFree(sx,sy)) return {x:sx, y:sy};
      }
    }
  }

  return {x:targetX, y:targetY};
}

function renderSwatches(){
  colorRow.innerHTML = "";
  for(const c of COLORS){
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch" + (c.key === selectedColor ? " selected" : "");
    b.style.background = c.css;
    b.title = c.key;
    b.addEventListener("click", () => {
      if(!selectedId) return;
      if(!isOwner(selectedId)){
        toast("not yours");
        return;
      }
      selectedColor = c.key;
      renderSwatches();
      updateLocal(selectedId, { color: selectedColor });
      syncNoteEl(selectedId);
      queueSave(selectedId);
    });
    colorRow.appendChild(b);
  }
}

function openDrawer(id){
  selectedId = id;
  const n = notes.find(x => x.id === id);
  if(!n) return;

  const mine = isOwner(id);
  ownerTag.classList.add("show");
  ownerTag.innerHTML = mine
    ? '<span class="ok">owned</span> • you can edit/move/delete this'
    : '<span class="no">locked</span> • you can read, but not edit/move';

  editText.value = n.text || "";
  selectedColor = n.color || "note1";
  renderSwatches();

  editText.disabled = !mine;
  btnDelete.disabled = !mine;

  metaId.textContent = `id: ${n.id}`;
  metaTime.textContent = `updated: ${n.updatedAt || "—"}`;
  metaPos.textContent = `pos: ${n.x}, ${n.y}`;

  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden","false");
  if(mine) editText.focus();
}

function closeDrawer(){
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden","true");
  selectedId = null;
  ownerTag.classList.remove("show");
}

function ensureNoteEl(n){
  let el = noteEls.get(n.id);
  if(el) return el;

  el = document.createElement("div");
  el.className = "note";
  el.dataset.id = n.id;

  const text = document.createElement("div");
  text.className = "text";

  el.appendChild(text);

  el.addEventListener("dblclick",(e)=>{e.preventDefault();openDrawer(el.dataset.id);});
installDrag(el);

  stage.appendChild(el);
  noteEls.set(n.id, el);
  return el;
}

function syncNoteEl(id){
  const n = notes.find(x => x.id === id);
  const el = noteEls.get(id);
  if(!n || !el) return;

  const mine = isOwner(id);
  el.classList.toggle("own", mine);
  el.classList.toggle("locked", !mine);

  el.style.left = `${n.x}px`;
  el.style.top  = `${n.y}px`;
  el.style.background = noteBg(n.color);

  el.querySelector(".text").textContent = safeText(n.text);

  if(selectedId === id){
    metaTime.textContent = `updated: ${n.updatedAt || "—"}`;
    metaPos.textContent = `pos: ${n.x}, ${n.y}`;
  }
}

function rerenderAll(){
  const ids = new Set(notes.map(n => n.id));
  for(const [id, el] of noteEls.entries()){
    if(!ids.has(id)){
      el.remove();
      noteEls.delete(id);
    }
  }
  for(const n of notes){
    ensureNoteEl(n);
    syncNoteEl(n.id);
  }
}

function updateLocal(id, patch){
  const i = notes.findIndex(n => n.id === id);
  if(i === -1) return;
  notes[i] = { ...notes[i], ...patch, updatedAt: nowISO() };
}

function replaceFromServer(serverNotes){

  notes = (serverNotes || []).map(n => ({
    id: n.id,
    text: n.text ?? "",
    x: Number.isFinite(n.x) ? snap(clamp(n.x, 0, STAGE_W - NOTE_W)) : snap(80),
    y: Number.isFinite(n.y) ? snap(clamp(n.y, 0, STAGE_H - NOTE_H)) : snap(80),
    color: n.color || "note1",
    updatedAt: n.updatedAt || n.updated_at || "—",
  }));
  rerenderAll();

  if(selectedId && !notes.some(n=>n.id===selectedId)) closeDrawer();
}

async function apiGetNotes(){
  const r = await fetch(`${API_BASE}/notes`, { method:"GET" });
  if(!r.ok) throw new Error(`GET failed ${r.status}`);
  return await r.json();
}

async function apiCreateNote(payload){
  const r = await fetch(`${API_BASE}/notes`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
  if(!r.ok) throw new Error(`POST failed ${r.status}`);
  return await r.json();
}

async function apiUpdateNote(id, payload){
  const r = await fetch(`${API_BASE}/notes/${encodeURIComponent(id)}`, {
    method:"PUT",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
  if(!r.ok) throw new Error(`PUT failed ${r.status}`);
  return await r.json();
}

async function apiDeleteNote(id, editKey){
  const r = await fetch(`${API_BASE}/notes/${encodeURIComponent(id)}`, {
    method:"DELETE",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ editKey })
  });
  if(!r.ok) throw new Error(`DELETE failed ${r.status}`);
  return await r.json().catch(()=>({ok:true}));
}

async function pollOnce(){
  try{
    const data = await apiGetNotes();
    apiOnline = true;
    if(Array.isArray(data.notes)) replaceFromServer(data.notes);
    setStatus(`online · ${notes.length} notes`);
  }catch(e){
    apiOnline = false;
    setStatus("offline / api not ready");
  }
}

function startPolling(){
  if(pollTimer) clearInterval(pollTimer);
  pollOnce();
  pollTimer = setInterval(pollOnce, POLL_MS);
}

function installDrag(el){
  let dragging=false;
  let startX=0,startY=0;
  let baseX=0,baseY=0;
  let moved=false;
  let downAt=0;

  const begin=(clientX,clientY,pointerId)=>{
    const id=el.dataset.id;
    if(!isOwner(id)){ toast("locked"); return false; }
    const n=notes.find(x=>x.id===id);
    if(!n) return false;

    dragging=true;
    moved=false;
    downAt=performance.now();

    startX=clientX;
    startY=clientY;
    baseX=n.x;
    baseY=n.y;

    el.setPointerCapture?.(pointerId);
    return true;
  };

  const moveTo=(clientX,clientY)=>{
    if(!dragging) return;
    const id=el.dataset.id;
    const dx=clientX-startX;
    const dy=clientY-startY;
    if(!moved && (Math.abs(dx)>6 || Math.abs(dy)>6)) moved=true;

    const nx=clamp(baseX+dx,0,STAGE_W-NOTE_W);
    const ny=clamp(baseY+dy,0,STAGE_H-NOTE_H);

    updateLocal(id,{x:nx,y:ny});
    syncNoteEl(id);
  };

  const end=()=>{
    if(!dragging) return;
    dragging=false;

    const id=el.dataset.id;
    const n=notes.find(x=>x.id===id);
    if(!n) return;

    if(!moved && (performance.now()-downAt)<320){
      if(performance.now() < __mobileReadyAt) return;
      openDrawer(id);
      return;
    }

    const placed=findFreeCellNear(n.x,n.y,id);
    updateLocal(id,{x:placed.x,y:placed.y});
    syncNoteEl(id);
    queueSave(id);
  };

  el.addEventListener("pointerdown",(e)=>{
    if(e.pointerType==="mouse" && e.button!==0) return;
    if(begin(e.clientX,e.clientY,e.pointerId)) e.preventDefault();
  },{passive:false});

  window.addEventListener("pointermove",(e)=>{
    if(!dragging) return;
    moveTo(e.clientX,e.clientY);
  },{passive:true});

  window.addEventListener("pointerup",()=>end(),{passive:true});
  window.addEventListener("pointercancel",()=>end(),{passive:true});
}


function queueSave(id){
  if(!id) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow(id), SAVE_DEBOUNCE_MS);
}

async function saveNow(id){
  const n = notes.find(x => x.id === id);
  if(!n) return;
  if(!isOwner(id)) return;

  if(!apiOnline){
    toast("api offline (not saved)");
    return;
  }

  try{
    setStatus("saving...");
    const editKey = getEditKey(id);
    const payload = { text:n.text, x:snap(n.x), y:snap(n.y), color:n.color, editKey };
    const data = await apiUpdateNote(id, payload);

    if(data?.note?.id){
      const s = data.note;
      updateLocal(id, {
        text: s.text ?? n.text,
        x: Number.isFinite(s.x) ? snap(clamp(s.x, 0, STAGE_W - NOTE_W)) : snap(n.x),
        y: Number.isFinite(s.y) ? snap(clamp(s.y, 0, STAGE_H - NOTE_H)) : snap(n.y),
        color: s.color || n.color,
        updatedAt: s.updatedAt || s.updated_at || nowISO()
      });
      syncNoteEl(id);
    }

    setStatus(`online · ${notes.length} notes`);
    toast("saved");
  }catch(e){
    setStatus("online · save failed");
    toast("save failed");
  }
}

btnNew.addEventListener("click", async () => {

  const proposed = findFreeCellNear(140 + Math.random()*120, 140 + Math.random()*120, null);
  const id = uid();
  const editKey = randKey();

  const n = {
    id,
    text: "",
    x: proposed.x,
    y: proposed.y,
    color: "note1",
    updatedAt: nowISO(),
  };

  setEditKey(id, editKey);
  notes.unshift(n);
  rerenderAll();
  openDrawer(id);

  if(!apiOnline){
    toast("created locally");
    return;
  }

  try{
    setStatus("creating...");

    const data = await apiCreateNote({
      id,
      text: n.text,
      x: n.x,
      y: n.y,
      color: n.color,
      editKey
    });

    if(data?.note?.id){
      const s = data.note;
      const newId = s.id;

      if(newId && newId !== id){

        const serverKey = s.editKey || editKey;
        deleteEditKey(id);
        setEditKey(newId, serverKey);

        notes = notes.map(x => x.id === id ? ({...x, id:newId}) : x);

        const el = noteEls.get(id);
        if(el){
          noteEls.delete(id);
          el.dataset.id = newId;
          noteEls.set(newId, el);
        }

        selectedId = newId;
      }

      updateLocal(selectedId, {
        x: Number.isFinite(s.x) ? snap(clamp(s.x, 0, STAGE_W - NOTE_W)) : n.x,
        y: Number.isFinite(s.y) ? snap(clamp(s.y, 0, STAGE_H - NOTE_H)) : n.y,
        color: s.color || n.color,
        updatedAt: s.updatedAt || s.updated_at || nowISO()
      });
      syncNoteEl(selectedId);
    }

    setStatus(`online · ${notes.length} notes`);
    toast("created");
  }catch(e){
    setStatus("online · create failed");
    toast("create failed");
  }
});

btnCenter.addEventListener("click", () => {
  toast("stage is fixed (prototype)");
});

btnRefresh.addEventListener("click", () => {
  pollOnce();
  toast("refreshed");
});

btnSound.addEventListener("click", () => {
  setSound(!soundEnabled);
  toast(soundEnabled ? "sound on" : "sound off");
});

btnCloseDrawer.addEventListener("click", closeDrawer);
btnDone.addEventListener("click", closeDrawer);

btnDelete.addEventListener("click", async () => {
  if(!selectedId) return;
  const id = selectedId;

  if(!isOwner(id)){
    toast("not yours");
    return;
  }

  const editKey = getEditKey(id);

  notes = notes.filter(n => n.id !== id);
  rerenderAll();
  closeDrawer();
  deleteEditKey(id);

  if(!apiOnline){
    toast("deleted locally");
    return;
  }

  try{
    setStatus("deleting...");
    await apiDeleteNote(id, editKey);
    setStatus(`online · ${notes.length} notes`);
    toast("deleted");
  }catch(e){
    setStatus("online · delete failed");
    toast("delete failed");
  }
});

editText.addEventListener("input", () => {
  if(!selectedId) return;
  if(!isOwner(selectedId)) return;

  updateLocal(selectedId, { text: editText.value });
  syncNoteEl(selectedId);
  queueSave(selectedId);
});

window.addEventListener("keydown", (e) => {
  if(e.key === "Escape" && drawer.classList.contains("open")) closeDrawer();
});

(function init(){
  renderSwatches();

  updateSoundButton();
  installFirstGestureHook();
  installUiSounds();
  if(soundEnabled) bgmPlaySafe();

  const a = uid(), b = uid();
  const kA = randKey(), kB = randKey();

  setEditKey(a, kA);

  notes = [
    { id: a, text:"this one is yours.\ntry dragging + editing.", x: snap(144), y: snap(168), color:"note2", updatedAt:"—" },
    { id: b, text:"this one is locked.\nyou can read but not move.", x: snap(432), y: snap(264), color:"note1", updatedAt:"—" },
  ];
  rerenderAll();
  closeDrawer();

  setStatus("offline / api not ready");
  startPolling();
})();
