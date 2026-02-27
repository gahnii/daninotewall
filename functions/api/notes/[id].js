export async function onRequest({ request, env, params }) {
  const id = (params.id || "").toString();

  const NOTEW = 240, NOTEH = 132, GRID = 24;
  const STAGE_W = 3000, STAGE_H = 2000;
  const MAX_LEN = 500;

  const HOURLY_MAX = 240;
  const COOLDOWN_S = 1;

  const STRIKES_PER_DAY = 8;

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
"54482595177116e6103b076dbf30648e5d0537dd1ed9cf5ae4562fa8a700d47b",
"d75a838dc758ba17f28bd8dbac605cb70c35465263d5733164521de2f7ef7926",
"08a841e996781e9e77d30a4e4420a8f501a280b00624e6d1224bf54aaff73eba",
"158869a97379229b7681efae9d7f9c9214134e836d649ba53477c0c111414d59",
"120f6e5b4ea32f65bda68452fcfaaef06b0136e1d0e4a6f60bc3771fa0936dd6",
"9ae315a94e428a7ee3b5e48adae6541965d93b86acf10ffa1c45b93b6fe577b4",
"bb61ef40814ce34c1edf0edb609854be9793198a8f60b67d9fb26643c32281d3",
"8f5083e3e5c7dc8932f2bf58212f963f3a44752618c96297f82623f736c52738",
"bd331fb1d24298f52943034a243a341877957b895f4372b11babb87262904ed6",
"c1cabb6f6e431f9c4dea4c3b3264d6fe3829241d674f3496a2dfff6658f0363e",
"32ef2fe14fb6c7fcf097ae19fedd90e7dc8126558fbc5ced34ad8ae5f9b5afe8",
"d10b0c158b95d32f0737bd5e34a64b4a50d004da07cb157896a8a1691a3c9e01",
"810224135a2dbf22b985d95f551137e7e08bfabb693560143a7d36a9cd5288c9",
"7bf4e34e8a0b4c11c9147c59233cf866e91d43e2b7962a5bd0520ba06a0f108d",
"3eed6d8f9ba46205b8fba3d622d26832fcc2a342b65e940a538aeb8c4d32af2d",
"341d56384afc0f47b34ca18273e793be555507a49444c30d3d0588688de46cb3",
"4426e54cf6f33618511f06c7d2efb39ce8b76e97eaf0f3d4c27e7b654e9528f1",
"14a81e30c432687c605866ee92c1bcf4b9ff0f66f0131f565998b64b6ea5e546",
"acf77b0391a69a23cc8692e631266a2fabb973568e13c437357e017258162f32",
"93a3a2590694f53f1028bfeea3a4ac2cf07879c29581369b7290e839fd1c8ad9",
"77173ace11f118f4cfaaa33d7c35ec612a1ca67dae67d54a4a677a465124b087",
"84f1cf20153ffa93b9fb7efed7055a71fc0c3b967ab072801877b928bb83205c",
"4cb0b250c6250d528f3e61d07d970892168db68bbff1ea5be4a851eda411adfb",
"21b5d62444736672de7530a48155d19d8d2eb2406f168dc9c31afe4058d85b99",
"eea0d58077cd6c8a3be46ca904a12a2faba6f682adba1f7cfc5e51b021b08b25",
"eddb4bf08e385854e659242ba5ae70355f7ae89802de7cdd663d9a49b621f42f",
"1e02eec4f1095143be282056557034d4e8ab915342c1af508223141d472d2347",
"8f214abedf20b69dd2e311d1b9d546090df9810c050307a5c757a2ef5ab7a67c",
"f97e555d302b5e1efa0ea6ccce88e6d61ea3fb4765b3deca42b36c94b7d281fd",
"96c1b283cc3ce059e3f1964758a72eb2e093fe53be97bb3f9f2cd6ca8f08ab53",
"96466cddbbf9e52fe585ecb0fa3f9dd16c7f92c656d8e958df8ad9fff9f7a44b",
"16fc5f927e3b294234a4afe611b6051418159b6e9e7a1ec4a59a48f204ee63ce",
"618280393ff3b998c3a972932871363877fff03b978b05aa2be1b3dc2c0b73c9",
"bff30e7fa9ed248e91475ab1161d1e0f2fd5e66d44b5b4a563778bafafa0a9dc",
"b9161446dbe32eff60e5c0321be6b981033441d765df60ee919cb8f0b9967e7f",
"0f28c4960d96647e77e7ab6d13b85bd16c7ca56f45df802cdc763a5e5c0c7863",
"ad505b0be8a49b89273e307106fa42133cbd804456724c5e7635bd953215d92a",
"796e43a5a8cdb73b92b5f59eb50610cea3efa8ce229cd7f0557983091b2b4552",
"f6952d6eef555ddd87aca66e56b91530222d6e318414816f3ba7cf5bf694bf0f",
"348d77e943a990e64b08bd3bafc7c1b3fde497e92670f78cd8e9eb27529706f2",
"83ebccea9fff4079ead732d05b9a762edbcda1cf3eab78bc7f3512abed918ab0",
"0508a634445d401652d06013cdcc95183ab78c58e406cfec6dc58a395958ef2b",
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

  if (request.method === "PUT") {
    if (!(await cooldown())) return json({ error: "slow down" }, 429);
    if (!(await hourlyLimit())) return json({ error: "rate limited" }, 429);

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }

    const notes = await loadNotes();
    const i = notes.findIndex(n => n.id === id);
    if (i === -1) return json({ error: "not found" }, 404);

    const wantsTextOrColor = body.text !== undefined || body.color !== undefined;
    const editKey = (body.editKey || "").toString();

    if (wantsTextOrColor && !editKey) return json({ error: "missing editKey" }, 403);

    if (editKey) {
      const keyHash = await sha256Hex(editKey);
      if (keyHash !== notes[i].keyHash) return json({ error: "forbidden" }, 403);
    }

    const nextText = (body.text ?? notes[i].text).toString().slice(0, MAX_LEN);

    if (wantsTextOrColor && (hasLinkLike(nextText) || await bannedHit(nextText))) {
      const ok = await addStrikeAndCheck();
      return json({ error: ok ? "blocked content" : "blocked (too many attempts today)" }, 403);
    }

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
