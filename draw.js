const API = "/api/drawings";
const els = {
  c: document.getElementById("c"),
  brush: document.getElementById("brush"),
  brushVal: document.getElementById("brushVal"),
  color: document.getElementById("color"),
  caption: document.getElementById("caption"),
  gallery: document.getElementById("gallery"),
  status: document.getElementById("status"),
  btnClear: document.getElementById("btnClear"),
  btnUndo: document.getElementById("btnUndo"),
  btnPublish: document.getElementById("btnPublish"),
  btnRefresh: document.getElementById("btnRefresh"),
  btnEraser: document.getElementById("btnEraser"),
  btnPen: document.getElementById("btnPen"),
  btnSound: document.getElementById("btnSound")
};

let soundOn = false;
let clickAudio = null;
let bgm = null;

function setStatus(t){ els.status.textContent = t; }
function playClick(){ if(soundOn && clickAudio){ try{ clickAudio.currentTime=0; clickAudio.play(); }catch(e){} } }

function initSound(){
  clickAudio = new Audio("assets/click.mp3");
  bgm = new Audio("assets/bgm.mp3");
  bgm.loop = true;
  bgm.volume = 0.35;
  els.btnSound.addEventListener("click", async ()=>{
    soundOn = !soundOn;
    els.btnSound.textContent = soundOn ? "sound: on" : "sound: off";
    try{
      if(soundOn){ await bgm.play(); playClick(); }
      else{ bgm.pause(); }
    }catch(e){}
  });
}

const ctx = els.c.getContext("2d", { alpha: true });
ctx.imageSmoothingEnabled = false;

let brush = parseInt(els.brush.value, 10);
let color = els.color.value;
let erasing = false;

els.brush.addEventListener("input", ()=>{ brush = parseInt(els.brush.value,10); els.brushVal.textContent = String(brush); });
els.color.addEventListener("input", ()=>{ color = els.color.value; });

els.btnEraser.addEventListener("click", ()=>{ playClick(); erasing = true; });
els.btnPen.addEventListener("click", ()=>{ playClick(); erasing = false; });

const history = [];
function pushHistory(){ if(history.length>=20) history.shift(); history.push(ctx.getImageData(0,0,512,512)); }
function undo(){ if(!history.length) return; ctx.putImageData(history.pop(),0,0); }
function clearCanvas(){ pushHistory(); ctx.clearRect(0,0,512,512); }

els.btnUndo.addEventListener("click", ()=>{ playClick(); undo(); });
els.btnClear.addEventListener("click", ()=>{ playClick(); clearCanvas(); });

let drawing = false;
let last = null;

function posFromEvent(e){
  const r = els.c.getBoundingClientRect();
  const t = (e.touches && e.touches[0]) ? e.touches[0] : e;
  const x = (t.clientX - r.left) * (els.c.width / r.width);
  const y = (t.clientY - r.top)  * (els.c.height/ r.height);
  return { x, y };
}

function startDraw(e){
  if(e.touches && e.touches.length>1) return;
  drawing = true;
  pushHistory();
  last = posFromEvent(e);
  e.preventDefault();
}
function moveDraw(e){
  if(!drawing) return;
  const p = posFromEvent(e);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = brush;

  if(erasing){
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0,0,0,1)";
  }else{
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = color;
  }

  ctx.beginPath();
  ctx.moveTo(last.x,last.y);
  ctx.lineTo(p.x,p.y);
  ctx.stroke();
  last = p;
  e.preventDefault();
}
function endDraw(){ drawing=false; last=null; }

els.c.addEventListener("mousedown", startDraw);
window.addEventListener("mousemove", moveDraw);
window.addEventListener("mouseup", endDraw);

els.c.addEventListener("touchstart", startDraw, { passive:false });
els.c.addEventListener("touchmove", moveDraw, { passive:false });
els.c.addEventListener("touchend", endDraw);
els.c.addEventListener("touchcancel", endDraw);

function toWebP(){
  try{ return els.c.toDataURL("image/webp", 0.85); }
  catch(e){ return els.c.toDataURL("image/png"); }
}

async function apiFetch(url, opts){
  const res = await fetch(url, { ...opts, headers: { "content-type":"application/json", ...(opts&&opts.headers||{}) } });
  const txt = await res.text();
  let data = null;
  try{ data = txt ? JSON.parse(txt) : null; }catch(e){}
  if(!res.ok) throw new Error((data && data.error) ? data.error : (txt || res.statusText));
  return data;
}

function fmtTime(iso){
  try{ return new Date(iso).toLocaleString(); }catch(e){ return iso||""; }
}

function render(list){
  els.gallery.innerHTML = "";
  for(const d of (list||[])){
    const card = document.createElement("div");
    card.className = "card";
    const img = document.createElement("img");
    img.src = d.dataUrl;
    img.loading = "lazy";
    const meta = document.createElement("div");
    meta.className = "meta";
    const cap = document.createElement("div");
    cap.className = "cap";
    cap.textContent = d.caption || "";
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span class="id">${d.id}</span><span>${fmtTime(d.createdAt)}</span>`;
    meta.appendChild(cap);
    meta.appendChild(row);
    card.appendChild(img);
    card.appendChild(meta);
    els.gallery.appendChild(card);
  }
}

async function refresh(){
  try{
    const data = await apiFetch(API, { method:"GET" });
    render(data.drawings);
    setStatus(`online • ${(data.drawings||[]).length} drawings`);
  }catch(e){
    setStatus("offline / api not ready");
  }
}

async function publish(){
  const dataUrl = toWebP();
  const caption = String(els.caption.value||"").slice(0,80);

  try{
    els.btnPublish.disabled = true;
    setStatus("publishing…");
    await apiFetch(API, { method:"POST", body: JSON.stringify({ dataUrl, caption }) });
    els.caption.value = "";
    setStatus("published");
    await refresh();
  }catch(e){
    setStatus("publish failed");
    alert(String(e.message||e));
  }finally{
    els.btnPublish.disabled = false;
  }
}

els.btnPublish.addEventListener("click", ()=>{ playClick(); publish(); });
els.btnRefresh.addEventListener("click", ()=>{ playClick(); refresh(); });

document.querySelectorAll("[data-bg]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    playClick();
    const bg = btn.getAttribute("data-bg");
    if(bg==="grid") els.c.style.background = "rgba(10,14,20,0.75)";
    if(bg==="paper") els.c.style.background = "rgba(20,18,10,0.35)";
    if(bg==="dark") els.c.style.background = "rgba(0,0,0,0.45)";
  });
});

initSound();
refresh();
setInterval(refresh, 8000);
