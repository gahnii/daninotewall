export async function onRequest({ request, env }) {
  const NOTEW = 240, NOTEH = 132, GRID = 24;
  const STAGE_W = 3000, STAGE_H = 2000;

  const MAX_NOTES = 200;
  const MAX_LEN = 500;

  const MAX_PER_DAY = 3;
  const HOURLY_MAX = 120;
  const COOLDOWN_S = 3;

  const STRIKES_PER_DAY = 8;

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
  function dayKey() { return new Date().toISOString().slice(0, 10); }

  function fold(s) {
    s = (s || "").toString().toLowerCase();
    s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    s = s.replace(/[\u200B-\u200D\uFEFF]/g, "");
    s = s.replace(/[@]/g, "a")
         .replace(/[!¡]/g, "i")
         .replace(/[|]/g, "i")
         .replace(/[0]/g, "o")
         .replace(/[1]/g, "i")
         .replace(/[3]/g, "e")
         .replace(/[4]/g, "a")
         .replace(/[5]/g, "s")
         .replace(/[7]/g, "t")
         .replace(/[$]/g, "s")
         .replace(/[+]/g, "t");
    s = s.replace(/[_\-.]/g, " ");
    s = s.replace(/[^a-z0-9 ]+/g, " ");
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }

  function squeezeLetters(s) {
    return s.replace(/([a-z])\1{2,}/g, "$1$1");
  }

  function joined(s) {
    return s.replace(/\s+/g, "");
  }

  function hasLinkLike(raw) {
    const t = (raw || "").toString().toLowerCase();
    if (t.includes("http://") || t.includes("https://") || t.includes("www.")) return true;
    if (t.includes("discord.gg") || t.includes("discord.com/invite") || t.includes("invite.gg")) return true;
    if (/\b(?:t\.me|telegram\.me)\b/.test(t)) return true;
    return false;
  }

  async function sha256Hex(str) {
    const data = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  const BANNED_HASHES = new Set([
  ]);

  async function bannedHit(rawText) {
    if (!BANNED_HASHES.size) return false;
    const a = fold(rawText);
    const b = squeezeLetters(a);
    const c = joined(b);
    const ha = await sha256Hex(a);
    const hb = await sha256Hex(b);
    const hc = await sha256Hex(c);
    return BANNED_HASHES.has(ha) || BANNED_HASHES.has(hb) || BANNED_HASHES.has(hc);
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
    const day = dayKey();
    const k = `cap:create:${ip}:${day}`;
    const cur = Number((await env.NOTEWALL.get(k)) || "0");
    if (cur >= MAX_PER_DAY) return false;
    await env.NOTEWALL.put(k, String(cur + 1), { expirationTtl: 60 * 60 * 48 });
    return true;
  }

  async function addStrikeAndCheck() {
    const day = dayKey();
    const k = `strike:${ip}:${day}`;
    const cur = Number((await env.NOTEWALL.get(k)) || "0");
    const next = cur + 1;
    await env.NOTEWALL.put(k, String(next), { expirationTtl: 60 * 60 * 48 });
    return next <= STRIKES_PER_DAY;
  }

  async function loadNotes() {
    const raw = await env.NOTEWALL.get("wall:notes");
    if (!raw) return [];
    try { return JSON.parse(raw) || []; } catch { return []; }
  }

  async function saveNotes(notes) {
    await env.NOTEWALL.put("wall:notes", JSON.stringify(notes));
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

    if (hasLinkLike(text) || await bannedHit(text)) {
      const ok = await addStrikeAndCheck();
      return json({ error: ok ? "blocked content" : "blocked (too many attempts today)" }, 403);
    }

    const notes = await loadNotes();
    if (notes.some(n => n.id === id)) return json({ error: "id exists" }, 409);

    if (notes.length >= MAX_NOTES) notes.pop();

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
