export async function onRequest({ request, env, params }) {
  const MAX_LEN = 500;
  const id = params.id;

  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });

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

  const notes = await load();
  const idx = notes.findIndex(n=>n.id===id);
  if(idx === -1) return json({error:"not found"},404);

  if(request.method === "PUT"){
    const body = await request.json();
    if(!body.editKey) return json({error:"no editKey"},403);
    if(await sha256(body.editKey) !== notes[idx].keyHash)
      return json({error:"forbidden"},403);

    notes[idx].text = (body.text ?? notes[idx].text).slice(0,MAX_LEN);
    notes[idx].color = body.color ?? notes[idx].color;
    notes[idx].updatedAt = new Date().toISOString();

    await save(notes);
    const { keyHash, ...safe } = notes[idx];
    return json({ note: safe });
  }

  if(request.method === "DELETE"){
    const body = await request.json();
    if(!body.editKey) return json({error:"no editKey"},403);
    if(await sha256(body.editKey) !== notes[idx].keyHash)
      return json({error:"forbidden"},403);

    notes.splice(idx,1);
    await save(notes);
    return json({ok:true});
  }

  return json({error:"method not allowed"},405);
}
