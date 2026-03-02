const els = {
  token: document.getElementById("token"),
  btnSaveToken: document.getElementById("btnSaveToken"),
  btnClearToken: document.getElementById("btnClearToken"),
  btnRefresh: document.getElementById("btnRefresh"),
  status: document.getElementById("status"),
  notesList: document.getElementById("notesList"),
  drawingsList: document.getElementById("drawingsList")
};

function setStatus(t){ els.status.textContent = t; }

function getToken(){ return localStorage.getItem("ADMIN_TOKEN") || ""; }
function setToken(v){ localStorage.setItem("ADMIN_TOKEN", v); }
function clearToken(){ localStorage.removeItem("ADMIN_TOKEN"); }

els.token.value = getToken();

els.btnSaveToken.addEventListener("click", ()=>{
  setToken(String(els.token.value||"").trim());
  setStatus("token saved");
});
els.btnClearToken.addEventListener("click", ()=>{
  clearToken();
  els.token.value = "";
  setStatus("token cleared");
});

async function api(url, opts){
  const token = getToken();
  const headers = { "content-type":"application/json", ...(opts&&opts.headers||{}) };
  if(token) headers["authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { ...opts, headers });
  const txt = await res.text();
  let data = null;
  try{ data = txt ? JSON.parse(txt) : null; }catch(e){}
  if(!res.ok) throw new Error((data && data.error) ? data.error : (txt || res.statusText));
  return data;
}

function esc(s){ return String(s||"").replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }

function noteRow(n){
  const div = document.createElement("div");
  div.className = "adminItem";
  div.innerHTML = `
    <div class="adminMeta">
      <div class="adminId">${esc(n.id)}</div>
      <div class="adminSub">${esc((n.updatedAt||"").slice(0,19))}</div>
    </div>
    <div class="adminText">${esc((n.text||"").slice(0,140))}</div>
    <div class="adminActions">
      <button class="btn small danger" data-del-note="${esc(n.id)}">delete</button>
    </div>
  `;
  return div;
}

function drawingRow(d){
  const div = document.createElement("div");
  div.className = "adminItem";
  div.innerHTML = `
    <div class="adminMeta">
      <div class="adminId">${esc(d.id)}</div>
      <div class="adminSub">${esc((d.createdAt||"").slice(0,19))}</div>
    </div>
    <div class="adminPreview"><img src="${esc(d.dataUrl)}" alt=""></div>
    <div class="adminText">${esc((d.caption||"").slice(0,140))}</div>
    <div class="adminActions">
      <button class="btn small danger" data-del-draw="${esc(d.id)}">delete</button>
    </div>
  `;
  return div;
}

async function refresh(){
  try{
    setStatus("loading…");
    const [notes, drawings] = await Promise.all([
      api("/api/notes", { method:"GET" }),
      api("/api/drawings", { method:"GET" })
    ]);

    els.notesList.innerHTML = "";
    (notes.notes||[]).slice().reverse().forEach(n=>els.notesList.appendChild(noteRow(n)));

    els.drawingsList.innerHTML = "";
    (drawings.drawings||[]).forEach(d=>els.drawingsList.appendChild(drawingRow(d)));

    setStatus(`ok • notes ${(notes.notes||[]).length} • drawings ${(drawings.drawings||[]).length}`);
  }catch(e){
    setStatus("offline / forbidden");
  }
}

els.btnRefresh.addEventListener("click", refresh);

document.addEventListener("click", async (e)=>{
  const btnN = e.target.closest && e.target.closest("[data-del-note]");
  if(btnN){
    const id = btnN.getAttribute("data-del-note");
    if(!confirm(`delete note ${id}?`)) return;
    try{
      await api(`/api/notes/${encodeURIComponent(id)}`, { method:"DELETE", body: "{}" });
      refresh();
    }catch(err){
      alert(String(err.message||err));
    }
  }

  const btnD = e.target.closest && e.target.closest("[data-del-draw]");
  if(btnD){
    const id = btnD.getAttribute("data-del-draw");
    if(!confirm(`delete drawing ${id}?`)) return;
    try{
      await api(`/api/drawings/${encodeURIComponent(id)}`, { method:"DELETE", body: "{}" });
      refresh();
    }catch(err){
      alert(String(err.message||err));
    }
  }
});

refresh();
