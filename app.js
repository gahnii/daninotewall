
/* =========================
   Sounds (click / hover / bgm)
   - browsers require a user gesture before audio can play
   - bgm starts on first interaction when sound is ON
   ========================= */
const SOUND_STORE = "noteWallSound_v1"; // "on" | "off"
let soundEnabled = (localStorage.getItem(SOUND_STORE) || "off") === "on";

const SFX = {
  click: new Audio("./assets/click.mp3"),
  hover: new Audio("./assets/hover.mp3"),
  bgm:   new Audio("./assets/bgm.mp3"),
};
SFX.click.preload = "auto";
SFX.hover.preload = "auto";
SFX.bgm.preload   = "auto";
SFX.bgm.loop = true;

// volumes
SFX.click.volume = 0.55;
SFX.hover.volume = 0.35;
SFX.bgm.volume   = 0.25;

let bgmStarted = false;
let lastHoverAt = 0;

function updateSoundButton(){
  if(!btnSound) return;
  btnSound.textContent = soundEnabled ? "sound: on" : "sound: off";
  btnSound.classList.toggle("soundOn", soundEnabled);
  btnSound.classList.toggle("soundOff", !soundEnabled);
}

function setSound(on){
  soundEnabled = !!on;
  localStorage.setItem(SOUND_STORE, soundEnabled ? "on" : "off");
  updateSoundButton();
  if(!soundEnabled){
    try{ SFX.bgm.pause(); }catch{}
  }else{
    armBgmStart();
  }
}

function playSfx(aud){
  if(!soundEnabled) return;
  try{
    const a = aud.cloneNode();
    a.volume = aud.volume;
    a.play().catch(()=>{});
  }catch{}
}

function playHover(){
  const now = Date.now();
  if(now - lastHoverAt < 60) return;
  lastHoverAt = now;
  playSfx(SFX.hover);
}

function playClick(){
  playSfx(SFX.click);
}

function armBgmStart(){
  if(!soundEnabled || bgmStarted) return;
  SFX.bgm.play().then(()=>{ bgmStarted = true; }).catch(()=>{});
}

function ensureBgmFromGesture(){
  if(!soundEnabled || bgmStarted) return;
  SFX.bgm.play().then(()=>{ bgmStarted = true; }).catch(()=>{});
}

function installFirstGestureHook(){
  const once = () => {
    ensureBgmFromGesture();
    window.removeEventListener("pointerdown", once, true);
    window.removeEventListener("keydown", once, true);
    window.removeEventListener("touchstart", once, true);
  };
  window.addEventListener("pointerdown", once, true);
  window.addEventListener("keydown", once, true);
  window.addEventListener("touchstart", once, true);
}

function installUiSounds(){
  const hoverTargets = [
    btnNew, btnCenter, btnRefresh, btnSound,
    btnCloseDrawer, btnDelete, btnDone
  ].filter(Boolean);

  for(const el of hoverTargets){
    el.addEventListener("mouseenter", playHover);
    el.addEventListener("focus", playHover);
    el.addEventListener("click", playClick);
  }

  stage.addEventListener("pointerover", (e) => {
    const note = e.target?.closest?.(".note");
    if(note) playHover();
  });

  if(editText){
    editText.addEventListener("focus", playHover);
  }
}

// app.js — Pixel Note Wall (grid + ownership)
//
// Goals:
// - Public board UX (everyone can see everything)
// - You can ONLY move/edit/delete notes you created (anonymous editKey)
// - Notes snap to grid so you can't cover/block other notes
//
// This file works even before API exists: it runs offline (no persistence).
// When you add the Worker API, it will start polling /api/notes and syncing.

const API_BASE = "/api";
const POLL_MS = 2000;
const SAVE_DEBOUNCE_MS = 450;

// Board dimensions (match CSS stage)
const STAGE_W = 3000;
const STAGE_H = 2000;

// Grid rules (match CSS --grid)
const GRID = 24; // px per cell
const NOTE_W = 240;
const NOTE_H = 132;

// If true: do strict grid occupancy; server should enforce too.
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
let noteEls = new Map();
let selectedId = null;
let selectedColor = "note1";
let apiOnline = false;

let pollTimer = null;
let saveTimer = null;

/* =========================
   Ownership storage
   We store editKeys locally:
   localStorage["noteKeys"] = { [noteId]: editKey }
   ========================= */
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

/* =========================
   Helpers
   ========================= */
function uid(){
  return "n_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function randKey(){
  // editKey should be unguessable; this is fine for prototype.
  // server should also generate/rotate if you want.
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
  // occupancy by top-left snapped coordinate
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
  // Spiral search around the desired snapped position.
  const targetX = clamp(snap(x), 0, STAGE_W - NOTE_W);
  const targetY = clamp(snap(y), 0, STAGE_H - NOTE_H);

  if(!ENFORCE_NO_OVERLAP) return {x:targetX, y:targetY};

  const occ = buildOccupancy(exceptId);
  const maxR = 40; // ~40 rings in grid units

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

  // If truly full, just return the snapped target; server can reject creation.
  return {x:targetX, y:targetY};
}

/* =========================
   Drawer
   ========================= */
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

/* =========================
   Rendering
   ========================= */
function ensureNoteEl(n){
  let el = noteEls.get(n.id);
  if(el) return el;

  el = document.createElement("div");
  el.className = "note";
  el.dataset.id = n.id;

  const text = document.createElement("div");
  text.className = "text";

  el.appendChild(text);

  el.addEventListener("dblclick", (e) => {
    e.preventDefault();
    openDrawer(n.id);
  });

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

  // update drawer meta if open
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

/* =========================
   Local state changes
   ========================= */
function updateLocal(id, patch){
  const i = notes.findIndex(n => n.id === id);
  if(i === -1) return;
  notes[i] = { ...notes[i], ...patch, updatedAt: nowISO() };
}

function replaceFromServer(serverNotes){
  // Keep local editKeys; just replace note contents/positions/colors from server.
  notes = (serverNotes || []).map(n => ({
    id: n.id,
    text: n.text ?? "",
    x: Number.isFinite(n.x) ? snap(clamp(n.x, 0, STAGE_W - NOTE_W)) : snap(80),
    y: Number.isFinite(n.y) ? snap(clamp(n.y, 0, STAGE_H - NOTE_H)) : snap(80),
    color: n.color || "note1",
    updatedAt: n.updatedAt || n.updated_at || "—",
  }));
  rerenderAll();

  // If the drawer is open on a note that disappeared, close it
  if(selectedId && !notes.some(n=>n.id===selectedId)) closeDrawer();
}

/* =========================
   API
   ========================= */
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

/* =========================
   Polling
   ========================= */
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

/* =========================
   Dragging (OWN notes only) + grid snap + no overlap
   ========================= */
function installDrag(el){
  let dragging = false;
  let startX = 0, startY = 0;
  let baseX = 0, baseY = 0;

  const onDown = (e) => {
    if(e.button !== 0) return;
    const id = el.dataset.id;

    if(!isOwner(id)){
      toast("locked");
      return;
    }

    dragging = true;
    el.setPointerCapture?.(e.pointerId);

    const n = notes.find(x => x.id === id);
    if(!n) return;

    startX = e.clientX;
    startY = e.clientY;
    baseX = n.x;
    baseY = n.y;
  };

  const onMove = (e) => {
    if(!dragging) return;

    const id = el.dataset.id;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const nx = clamp(baseX + dx, 0, STAGE_W - NOTE_W);
    const ny = clamp(baseY + dy, 0, STAGE_H - NOTE_H);

    updateLocal(id, { x: nx, y: ny });
    // during drag, don't snap yet (feels smoother)
    syncNoteEl(id);
  };

  const onUp = () => {
    if(!dragging) return;
    dragging = false;

    const id = el.dataset.id;
    const n = notes.find(x => x.id === id);
    if(!n) return;

    // snap + find free cell
    const placed = findFreeCellNear(n.x, n.y, id);
    updateLocal(id, { x: placed.x, y: placed.y });
    syncNoteEl(id);

    queueSave(id);
  };

  el.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

/* =========================
   Saving (debounced)
   ========================= */
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

    // If server returns canonical note, merge it (and keep our key)
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

/* =========================
   UI actions
   ========================= */
btnNew.addEventListener("click", async () => {
  // propose a spot near top-left-ish and find a free cell
  const proposed = findFreeCellNear(140 + Math.random()*120, 140 + Math.random()*120, null);
  const id = uid();
  const editKey = randKey();

  // local optimistic create
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

    // send create
    const data = await apiCreateNote({
      id,
      text: n.text,
      x: n.x,
      y: n.y,
      color: n.color,
      editKey
    });

    // If server assigns a new id/key, reconcile.
    // (Recommended: server keeps client id, but this supports either.)
    if(data?.note?.id){
      const s = data.note;
      const newId = s.id;

      if(newId && newId !== id){
        // move stored editKey to new id if server returns it
        const serverKey = s.editKey || editKey;
        deleteEditKey(id);
        setEditKey(newId, serverKey);

        // update note id
        notes = notes.map(x => x.id === id ? ({...x, id:newId}) : x);

        // remap element
        const el = noteEls.get(id);
        if(el){
          noteEls.delete(id);
          el.dataset.id = newId;
          noteEls.set(newId, el);
        }

        selectedId = newId;
      }

      // merge canonical placement
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

  // optimistic local remove
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

/* =========================
   Boot
   ========================= */
(function init(){
  renderSwatches();

  updateSoundButton();
  installFirstGestureHook();
  installUiSounds();
  if(soundEnabled) armBgmStart();

  // Seed notes (offline demo)
  const a = uid(), b = uid();
  const kA = randKey(), kB = randKey();

  // Seed ownership for ONLY the first note (so you can see locked behavior)
  setEditKey(a, kA);

  notes = [
    { id: a, text:"this one is yours.\ntry dragging + editing.", x: snap(144), y: snap(168), color:"note2", updatedAt:"—" },
    { id: b, text:"this one is locked.\nyou can read but not move.", x: snap(432), y: snap(264), color:"note1", updatedAt:"—" },
  ];
  rerenderAll();

  setStatus("offline / api not ready");
  startPolling();
})();


function installPan(){
  const scroller = document.querySelector(".stageWrap") || document.getElementById("stageWrap") || document.getElementById("wrap") || document.querySelector(".wrap");
  if(!scroller) return;

  let panning=false;
  let sx=0, sy=0, sl=0, st=0;

  scroller.addEventListener("pointerdown",(e)=>{
    if(e.button!=null && e.button!==0) return;
    if(e.target && e.target.closest && e.target.closest(".note")) return;
    panning=true;
    sx=e.clientX; sy=e.clientY;
    sl=scroller.scrollLeft; st=scroller.scrollTop;
    scroller.setPointerCapture?.(e.pointerId);
    scroller.classList.add("panning");
  });

  scroller.addEventListener("pointermove",(e)=>{
    if(!panning) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    scroller.scrollLeft = sl - dx;
    scroller.scrollTop  = st - dy;
  });

  const end=()=>{
    if(!panning) return;
    panning=false;
    scroller.classList.remove("panning");
  };
  scroller.addEventListener("pointerup", end);
  scroller.addEventListener("pointercancel", end);
}


try{installPan();}catch(e){}
