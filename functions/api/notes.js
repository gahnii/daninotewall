export async function onRequest({ request, env }) {
  const NOTEW = 240, NOTEH = 132, GRID = 24;
  const STAGE_W = 3000, STAGE_H = 2000;
  const MAX_NOTES = 200;
  const MAX_LEN = 500;

  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });

  function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }
  function snap(n){ return Math.round(n / GRID) * GRID; }
  function now(){ return new Date().toISOString(); }

  async function sha256(str){
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
  }

  async function load(){
    const raw = await env.NOTEWALL.get("wall:notes");
    return raw ? JSON.parse(raw) : [];
  }

  async function save(notes){
    await env.NOTEWALL.put("wall:notes", JSON.stringify(notes));
  }

  if (request.method === "GET") {
    const notes = await load();
    return json({ notes: notes.map(({keyHash,...n})=>n) });
  }

  if (request.method === "POST") {
    const body = await request.json();
    const { id, text="", x, y, color="note1", editKey } = body;

    if(!id || !editKey) return json({error:"missing id/editKey"},400);

    const notes = await load();
    if(notes.length >= MAX_NOTES) return json({error:"wall full"},409);

    const note = {
      id,
      text: text.slice(0, MAX_LEN),
      x: snap(clamp(x,0,STAGE_W-NOTEW)),
      y: snap(clamp(y,0,STAGE_H-NOTEH)),
      color,
      updatedAt: now(),
      keyHash: await sha256(editKey)
    };

    notes.unshift(note);
    await save(notes);

    const { keyHash, ...safe } = note;
    return json({ note: safe });
  }

  return json({error:"method not allowed"},405);
}
