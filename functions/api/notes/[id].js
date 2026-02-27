export async function onRequest({ request, env, params }) {
  const id = params.id;

  // match
  const NOTEW = 240, NOTEH = 132, GRID = 24;
  const STAGE_W = 3000, STAGE_H = 2000;
  const MAX_LEN = 500;

  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function snap(n) { return Math.round(n / GRID) * GRID; }
  function now() { return new Date().toISOString(); }

  function rectsOverlap(a, b) {
    return !(
      a.x + NOTEW <= b.x ||
      b.x + NOTEW <= a.x ||
      a.y + NOTEH <= b.y ||
      b.y + NOTEH <= a.y
    );
  }

  function findFreePos(notes, x, y, exceptId) {
    const sx = snap(clamp(x, 0, STAGE_W - NOTEW));
    const sy = snap(clamp(y, 0, STAGE_H - NOTEH));

    const other = notes.filter(n => n.id !== exceptId);
    const okAt = (px, py) => !other.some(n => rectsOverlap({ x: px, y: py }, n));

    if (okAt(sx, sy)) return { x: sx, y: sy };

    // spiral search around the intended cell
    const maxR = 60;
    for (let r = 1; r <= maxR; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (const c of [
          { x: sx + dx * GRID, y: sy - r * GRID },
          { x: sx + dx * GRID, y: sy + r * GRID },
        ]) {
          const px = snap(clamp(c.x, 0, STAGE_W - NOTEW));
          const py = snap(clamp(c.y, 0, STAGE_H - NOTEH));
          if (okAt(px, py)) return { x: px, y: py };
        }
      }
      for (let dy = -r + 1; dy <= r - 1; dy++) {
        for (const c of [
          { x: sx - r * GRID, y: sy + dy * GRID },
          { x: sx + r * GRID, y: sy + dy * GRID },
        ]) {
          const px = snap(clamp(c.x, 0, STAGE_W - NOTEW));
          const py = snap(clamp(c.y, 0, STAGE_H - NOTEH));
          if (okAt(px, py)) return { x: px, y: py };
        }
      }
    }

    return { x: sx, y: sy };
  }

  async function sha256(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async function load() {
    const raw = await env.NOTEWALL.get("wall:notes");
    return raw ? JSON.parse(raw) : [];
  }

  async function save(notes) {
    await env.NOTEWALL.put("wall:notes", JSON.stringify(notes));
  }

  const notes = await load();
  const idx = notes.findIndex(n => n.id === id);
  if (idx === -1) return json({ error: "not found" }, 404);

  if (request.method === "PUT") {
    const body = await request.json();
    if (!body.editKey) return json({ error: "no editKey" }, 403);

    const keyHash = await sha256(body.editKey);
    if (keyHash !== notes[idx].keyHash) return json({ error: "forbidden" }, 403);

    // update text/color
    notes[idx].text = (body.text ?? notes[idx].text).toString().slice(0, MAX_LEN);
    notes[idx].color = (body.color ?? notes[idx].color).toString();

    // update pos if provided
    const hasX = Number.isFinite(Number(body.x));
    const hasY = Number.isFinite(Number(body.y));
    if (hasX && hasY) {
      const placed = findFreePos(notes, Number(body.x), Number(body.y), id);
      notes[idx].x = placed.x;
      notes[idx].y = placed.y;
    }

    notes[idx].updatedAt = now();
    await save(notes);

    const { keyHash: _, ...safe } = notes[idx];
    return json({ note: safe });
  }

  if (request.method === "DELETE") {
    const body = await request.json().catch(() => ({}));
    if (!body.editKey) return json({ error: "no editKey" }, 403);

    const keyHash = await sha256(body.editKey);
    if (keyHash !== notes[idx].keyHash) return json({ error: "forbidden" }, 403);

    notes.splice(idx, 1);
    await save(notes);
    return json({ ok: true });
  }

  return json({ error: "method not allowed" }, 405);
}
