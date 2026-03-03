export async function onRequest({ request, env }) {
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });

  const KV = env.NOTEWALL;
  if (!KV) return json({ error: "KV binding NOTEWALL missing" }, 503);

  const MAX_ITEMS = 100;
  const MAX_BYTES = 450000;
  const MAX_CAP = 80;

  const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
  const hourKey = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  const limitKey = `draw:lim:${hourKey}:${ip}`;

  async function getJSON(key, fallback) {
    const raw = await KV.get(key);
    return raw ? JSON.parse(raw) : fallback;
  }
  async function putJSON(key, val) {
    await KV.put(key, JSON.stringify(val));
  }

  if (request.method === "GET") {
    const list = await getJSON("draw:latest", []);
    return json({ drawings: list });
  }

  if (request.method === "POST") {
    let body;
    try { body = await request.json(); }
    catch { return json({ error: "bad json" }, 400); }

    const dataUrl = String(body.dataUrl || "");
    const caption = String(body.caption || "").slice(0, MAX_CAP);

    if (!dataUrl.startsWith("data:image/")) return json({ error: "invalid image" }, 400);
    if (dataUrl.length > MAX_BYTES) return json({ error: "image too large" }, 413);

    // 1 drawing per IP per hour (soft limit)
    const used = await KV.get(limitKey);
    if (used) return json({ error: "rate limited (1 per hour)" }, 429);
    await KV.put(limitKey, "1", { expirationTtl: 3600 });

    const id = "d_" + crypto.randomUUID().slice(0, 8);
    const createdAt = new Date().toISOString();
    const entry = { id, dataUrl, caption, createdAt };

    const latest = await getJSON("draw:latest", []);
    latest.unshift(entry);
    if (latest.length > MAX_ITEMS) latest.length = MAX_ITEMS;
    await putJSON("draw:latest", latest);

    await putJSON(`draw:item:${id}`, entry);

    return json({ drawing: entry }, 200);
  }

  return json({ error: "method not allowed" }, 405);
}
