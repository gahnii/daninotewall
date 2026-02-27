export async function onRequest({ request, env }) {
  const NOTEW = 240, NOTEH = 132, GRID = 24;
  const STAGE_W = 3000, STAGE_H = 2000;

  const MAX_NOTES = 200;
  const MAX_LEN = 500;

  const MAX_PER_DAY = 3;
  const HOURLY_MAX = 120;
  const COOLDOWN_S = 3;

  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });

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
    const k = `cool:${ip}`;
    if (await env.NOTEWALL.get(k)) return false;
    await env.NOTEWALL.put(k, "1", { expirationTtl: COOLDOWN_S });
    return true;
  }

  async function hourlyLimit() {
    const k = `rlh:${ip}`;
    const cur = Number((await env.NOTEWALL.get(k)) || "0");
    if (cur >= HOURLY_MAX) return false;
    await env.NOTEWALL.put(k, String(cur + 1), { expirationTtl: 3600 });
    return true;
  }

  async function dailyCreateCap() {
    const day = new Date().toISOString().slice(0, 10);
    const k = `cap:create:${ip}:${day}`;
    const cur = Number((await env.NOTEWALL.get(k)) || "0");
    if (cur >= MAX_PER_DAY) return false;
    await env.NOTEWALL.put(k, String(cur + 1), { expirationTtl: 60 * 60 * 48 });
    return true;
  }

  if (request.method === "GET") {
    const notes = await loadNotes();
    const safe = notes.map(({ keyHash, ...rest }) => rest);
    return json({ notes: safe });
  }

  if (request.method === "POST") {
    if (!(await cooldown())) return json({ error: "slow down" }, 429);
    if (!(await hourlyLimit())) return json({ error: "rate limited" }, 429);
    if (!(await dailyCreateCap())) return json({ error: `daily limit (${MAX_PER_DAY}) reached` }, 429);

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }

    const id = (body.id || "").toString().slice(0, 80);
    const editKey = (body.editKey || "").toString();
    const text = (body.text || "").toString().slice(0, MAX_LEN);
    const color = (body.color || "note1").toString().slice(0, 16);

    const x = Number(body.x);
    const y = Number(body.y);

    if (!id || !editKey) return json({ error: "missing id/editKey" }, 400);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return json({ error: "bad coords" }, 400);

    const notes = await loadNotes();
    if (notes.length >= MAX_NOTES) return json({ error: "wall full" }, 409);
    if (notes.some(n => n.id === id)) return json({ error: "id exists" }, 409);

    const note = {
      id,
      text,
      x: snap(clamp(x, 0, STAGE_W - NOTEW)),
      y: snap(clamp(y, 0, STAGE_H - NOTEH)),
      color,
      updatedAt: nowISO(),
      keyHash: await sha256Hex(editKey),
    };

    notes.unshift(note);
    await saveNotes(notes);

    const { keyHash, ...safeNote } = note;
    return json({ note: safeNote });
  }

  return json({ error: "method not allowed" }, 405);
}
