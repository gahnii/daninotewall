const API_LIST = "/api/notes";

const STAGE_W = 3000;
const STAGE_H = 2000;
const NOTEW = 240;
const NOTEH = 132;
const GRID = 24;

const stage = document.getElementById("stage");
const world = document.getElementById("world");

const btnNew = document.getElementById("btnNew");
const btnCenter = document.getElementById("btnCenter");
const btnRefresh = document.getElementById("btnRefresh");

const toastEl = document.getElementById("toast");

const modal = document.getElementById("modal");
const editText = document.getElementById("editText");
const editColor = document.getElementById("editColor");
const btnSave = document.getElementById("btnSave");
const btnDelete = document.getElementById("btnDelete");
const btnClose = document.getElementById("btnClose");

let notes = [];
let noteElById = new Map();

let view = { x: 0, y: 0, s: 1 };

let active = null;
let pinch = null;

let tapCandidate = null;
const TAP_MS = 260;
const TAP_PX = 8;

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function snap(n) { return Math.round(n / GRID) * GRID; }

function toast(msg, ms = 1400) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => (toastEl.hidden = true), ms);
}

function applyView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
}

function centerView() {
  const rect = stage.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  view.s = 1;
  view.x = cx - (STAGE_W / 2);
  view.y = cy - (STAGE_H / 2);
  applyView();
}

function screenToWorld(px, py) {
  const rect = stage.getBoundingClientRect();
  const x = (px - rect.left - view.x) / view.s;
  const y = (py - rect.top - view.y) / view.s;
  return { x, y };
}

function worldToSnapped(x, y) {
  const nx = snap(clamp(x, 0, STAGE_W - NOTEW));
  const ny = snap(clamp(y, 0, STAGE_H - NOTEH));
  return { x: nx, y: ny };
}

function makeId() {
  return "n_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getKeys() {
  try { return JSON.parse(localStorage.getItem("noteKeys") || "{}"); }
  catch { return {}; }
}
function setKeys(obj) {
  localStorage.setItem("noteKeys", JSON.stringify(obj));
}
function getKey(id) {
  return getKeys()[id];
}
function setKey(id, key) {
  const k = getKeys();
  k[id] = key;
  setKeys(k);
}

function randomKey() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function apiJson(url, opts) {
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function renderAll() {
  world.innerHTML = "";
  noteElById.clear();
  for (const n of notes) {
    const el = document.createElement("div");
    el.className = `note ${n.color || "note1"}`;
    el.style.left = `${n.x}px`;
    el.style.top = `${n.y}px`;
    el.dataset.id = n.id;

    el.innerHTML = `
      <div class="noteInner">
        <div class="noteTop">
          <span class="pill">public</span>
          <span class="pill">tap</span>
        </div>
        <div class="noteText"></div>
      </div>
    `;
    el.querySelector(".noteText").textContent = n.text || "";
    world.appendChild(el);
    noteElById.set(n.id, el);
  }
}

function updateNotePos(id, x, y) {
  const el = noteElById.get(id);
  if (!el) return;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

async function refresh() {
  try {
    const data = await apiJson(API_LIST, { method: "GET" });
    notes = Array.isArray(data.notes) ? data.notes : [];
    renderAll();
  } catch (e) {
    toast(`refresh failed: ${e.message}`);
  }
}

async function createNote() {
  const id = makeId();
  const editKey = randomKey();
  setKey(id, editKey);

  const rect = stage.getBoundingClientRect();
  const pt = screenToWorld(rect.left + rect.width * 0.5, rect.top + rect.height * 0.5);
  const pos = worldToSnapped(pt.x - NOTEW / 2, pt.y - NOTEH / 2);

  try {
    const payload = { id, text: "tap to edit", x: pos.x, y: pos.y, color: "note1", editKey };
    const data = await apiJson(API_LIST, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    notes.unshift(data.note);
    renderAll();
    toast("created");
  } catch (e) {
    toast(`create failed: ${e.message}`);
  }
}

function openModal(note) {
  modal.hidden = false;
  modal.dataset.id = note.id;
  editText.value = note.text || "";
  editColor.value = note.color || "note1";
  setTimeout(() => editText.focus(), 60);
}

function closeModal() {
  modal.hidden = true;
  modal.dataset.id = "";
}

function findNote(id) {
  return notes.find(n => n.id === id);
}

async function saveEdit() {
  const id = modal.dataset.id;
  const note = findNote(id);
  if (!note) { closeModal(); return; }

  const editKey = getKey(id);
  if (!editKey) { toast("no key on this device"); return; }

  const nextText = editText.value.slice(0, 500);
  const nextColor = editColor.value;

  try {
    const data = await apiJson(`/api/notes/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ editKey, text: nextText, color: nextColor }),
    });

    const idx = notes.findIndex(n => n.id === id);
    if (idx !== -1) notes[idx] = data.note;
    renderAll();
    toast("saved");
    closeModal();
  } catch (e) {
    toast(`save failed: ${e.message}`);
  }
}

async function deleteNote() {
  const id = modal.dataset.id;
  const editKey = getKey(id);
  if (!editKey) { toast("no key on this device"); return; }

  try {
    await apiJson(`/api/notes/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ editKey }),
    });

    notes = notes.filter(n => n.id !== id);
    renderAll();
    toast("deleted");
    closeModal();
  } catch (e) {
    toast(`delete failed: ${e.message}`);
  }
}

async function saveMove(id, x, y) {
  try {
    await apiJson(`/api/notes/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x, y }),
    });
  } catch (e) {
    toast(`move failed: ${e.message}`);
  }
}

function noteFromTarget(t) {
  const el = t.closest?.(".note");
  return el ? el.dataset.id : null;
}

function beginPan(ev) {
  const p = { x: ev.clientX, y: ev.clientY };
  active = { type: "pan", pointerId: ev.pointerId, startX: p.x, startY: p.y, vx: view.x, vy: view.y };
  stage.setPointerCapture(ev.pointerId);
  tapCandidate = null;
}

function beginDrag(ev, id) {
  const p = { x: ev.clientX, y: ev.clientY };
  const w = screenToWorld(p.x, p.y);
  const note = findNote(id);
  if (!note) return;

  active = {
    type: "drag",
    id,
    pointerId: ev.pointerId,
    startX: p.x,
    startY: p.y,
    offX: w.x - note.x,
    offY: w.y - note.y,
  };
  stage.setPointerCapture(ev.pointerId);

  tapCandidate = { id, t: performance.now(), x: p.x, y: p.y, pointerId: ev.pointerId };
}

function onPointerDown(ev) {
  if (modal && !modal.hidden) return;
  if (ev.pointerType === "mouse" && ev.button !== 0) return;
  if (pinch) return;

  const id = noteFromTarget(ev.target);
  if (id) beginDrag(ev, id);
  else beginPan(ev);

  ev.preventDefault();
}

function onPointerMove(ev) {
  if (!active) return;
  if (active.pointerId !== ev.pointerId) return;

  const p = { x: ev.clientX, y: ev.clientY };

  if (tapCandidate && tapCandidate.pointerId === ev.pointerId) {
    const dx = p.x - tapCandidate.x;
    const dy = p.y - tapCandidate.y;
    if (Math.hypot(dx, dy) > TAP_PX) tapCandidate = null;
  }

  if (active.type === "pan") {
    const dx = p.x - active.startX;
    const dy = p.y - active.startY;
    view.x = active.vx + dx;
    view.y = active.vy + dy;
    applyView();
    ev.preventDefault();
    return;
  }

  if (active.type === "drag") {
    const w = screenToWorld(p.x, p.y);
    const pos = worldToSnapped(w.x - active.offX, w.y - active.offY);

    const note = findNote(active.id);
    if (!note) return;

    note.x = pos.x;
    note.y = pos.y;
    updateNotePos(note.id, note.x, note.y);

    ev.preventDefault();
    return;
  }
}

async function endPointer(ev) {
  if (!active) return;
  if (active.pointerId !== ev.pointerId) return;

  const finished = active;
  active = null;

  if (tapCandidate && tapCandidate.pointerId === ev.pointerId) {
    const dt = performance.now() - tapCandidate.t;
    const id = tapCandidate.id;
    tapCandidate = null;
    if (dt <= TAP_MS) {
      const note = findNote(id);
      if (note) openModal(note);
      return;
    }
  }

  tapCandidate = null;

  if (finished.type === "drag") {
    const note = findNote(finished.id);
    if (note) await saveMove(note.id, note.x, note.y);
  }
}

function onPointerUp(ev) { endPointer(ev); }
function onPointerCancel(ev) { endPointer(ev); }

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function onTouchStart(ev) {
  if (modal && !modal.hidden) return;
  if (ev.touches.length === 2) {
    const t1 = ev.touches[0], t2 = ev.touches[1];
    pinch = {
      startDist: dist({ x: t1.clientX, y: t1.clientY }, { x: t2.clientX, y: t2.clientY }),
      startScale: view.s,
      startView: { x: view.x, y: view.y, s: view.s },
    };
    active = null;
    tapCandidate = null;
  }
}

function onTouchMove(ev) {
  if (!pinch || ev.touches.length !== 2) return;
  const t1 = ev.touches[0], t2 = ev.touches[1];

  const curDist = dist({ x: t1.clientX, y: t1.clientY }, { x: t2.clientX, y: t2.clientY });
  const ratio = curDist / pinch.startDist;

  const newScale = clamp(pinch.startScale * ratio, 0.6, 2.2);

  const rect = stage.getBoundingClientRect();
  const midX = (t1.clientX + t2.clientX) / 2 - rect.left;
  const midY = (t1.clientY + t2.clientY) / 2 - rect.top;

  const worldX = (midX - pinch.startView.x) / pinch.startView.s;
  const worldY = (midY - pinch.startView.y) / pinch.startView.s;

  view.s = newScale;
  view.x = midX - worldX * view.s;
  view.y = midY - worldY * view.s;

  applyView();
  ev.preventDefault();
}

function onTouchEnd(ev) {
  if (ev.touches.length < 2) pinch = null;
}

btnNew.addEventListener("click", createNote);
btnCenter.addEventListener("click", () => { centerView(); toast("centered"); });
btnRefresh.addEventListener("click", refresh);

btnClose.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

btnSave.addEventListener("click", saveEdit);
btnDelete.addEventListener("click", deleteNote);

stage.addEventListener("pointerdown", onPointerDown, { passive: false });
stage.addEventListener("pointermove", onPointerMove, { passive: false });
stage.addEventListener("pointerup", onPointerUp, { passive: false });
stage.addEventListener("pointercancel", onPointerCancel, { passive: false });

stage.addEventListener("touchstart", onTouchStart, { passive: false });
stage.addEventListener("touchmove", onTouchMove, { passive: false });
stage.addEventListener("touchend", onTouchEnd, { passive: false });
stage.addEventListener("touchcancel", onTouchEnd, { passive: false });

centerView();
refresh();
setInterval(refresh, 4000);
