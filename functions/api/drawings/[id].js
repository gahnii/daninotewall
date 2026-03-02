export async function onRequest({ request, env, params }) {
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });

  const KV = env.NOTEWALL;
  if (!KV) return json({ error: "KV binding NOTEWALL missing" }, 503);

  const id = params.id;
  const admin = env.ADMIN_TOKEN || "";
  const auth = request.headers.get("authorization") || "";
  const ok = admin && auth === `Bearer ${admin}`;

  if (request.method !== "DELETE") return json({ error: "method not allowed" }, 405);
  if (!ok) return json({ error: "forbidden" }, 403);

  await KV.delete(`draw:item:${id}`);

  const raw = await KV.get("draw:latest");
  const latest = raw ? JSON.parse(raw) : [];
  const next = latest.filter(x => x && x.id !== id);
  await KV.put("draw:latest", JSON.stringify(next));

  return json({ ok: true }, 200);
}
