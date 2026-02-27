export async function onRequest({ request, env, params }) {
  const id = (params.id || "").toString();

  const NOTEW = 240, NOTEH = 132, GRID = 24;
  const STAGE_W = 3000, STAGE_H = 2000;
  const MAX_LEN = 500;

  const HOURLY_MAX = 240;
  const COOLDOWN_S = 1;

  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });

  if (!id) return json({ error: "missing id" }, 400);

  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "unknown";

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function snap(n) { return Math.round(n / GRID) * GRID; }
  function nowISO() { return new Date().toISOString(); }

  async function sha256Hex(str) {
    const data = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async function loadNotes() {
    const raw = await env.NOTEWALL.get("wall:notes");
    if (!raw) return [];
    try { return JSON.parse(raw) || []; } catch { return []; }
  }

  async function saveNotes(notes) {
    await env.NOTEWALL.put("wall:notes", JSON.stringify(notes));
  }

  async function cooldown() {
    const k = `cool2:${ip}`;
    if (await env.NOTEWALL.get(k)) return false;
    await env.NOTEWALL.put(k, "1", { expirationTtl: COOLDOWN_S });
    return true;
  }

  async function hourlyLimit() {
    const k = `rlh2:${ip}`;
    const cur = Number((await env.NOTEWALL.get(k)) || "0");
    if (cur >= HOURLY_MAX) return false;
    await env.NOTEWALL.put(k, String(cur + 1), { expirationTtl: 3600 });
    return true;
  }

  if (request.method === "PUT") {
    if (!(await cooldown())) return json({ error: "slow down" }, 429);
    if (!(await hourlyLimit())) return json({ error: "rate limited" }, 429);

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }

    const editKey = (body.editKey || "").toString();
    if (!editKey) return json({ error: "missing editKey" }, 403);

    const notes = await loadNotes();
    const i = notes.findIndex(n => n.id === id);
    if (i === -1) return json({ error: "not found" }, 404);

    const keyHash = await sha256Hex(editKey);
    if (keyHash !== notes[i].keyHash) return json({ error: "forbidden" }, 403);

    const nextText = (body.text ?? notes[i].text).toString().slice(0, MAX_LEN);
    const nextColor = (body.color ?? notes[i].color).toString().slice(0, 16);

    const hasX = Number.isFinite(Number(body.x));
    const hasY = Number.isFinite(Number(body.y));

    let nextX = notes[i].x;
    let nextY = notes[i].y;

    if (hasX && hasY) {
      nextX = snap(clamp(Number(body.x), 0, STAGE_W - NOTEW));
      nextY = snap(clamp(Number(body.y), 0, STAGE_H - NOTEH));
    }

    notes[i] = {
      ...notes[i],
      text: nextText,
      color: nextColor,
      x: nextX,
      y: nextY,
      updatedAt: nowISO(),
    };

    await saveNotes(notes);

    const { keyHash: _, ...safe } = notes[i];
    return json({ note: safe });
  }

  if (request.method === "DELETE") {
    if (!(await cooldown())) return json({ error: "slow down" }, 429);
    if (!(await hourlyLimit())) return json({ error: "rate limited" }, 429);

    let body = {};
    try { body = await request.json(); } catch {}

    const editKey = (body.editKey || "").toString();
    if (!editKey) return json({ error: "missing editKey" }, 403);

    const notes = await loadNotes();
    const i = notes.findIndex(n => n.id === id);
    if (i === -1) return json({ error: "not found" }, 404);

    const keyHash = await sha256Hex(editKey);
    if (keyHash !== notes[i].keyHash) return json({ error: "forbidden" }, 403);

    notes.splice(i, 1);
    await saveNotes(notes);

    return json({ ok: true });
  }

  return json({ error: "method not allowed" }, 405);
}
