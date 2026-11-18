import { getUser, json, store } from "../lib/auth.mjs";

export const config = { path: "/api/sync" };

// Copia de seguridad de los datos de cada usuario en Netlify Blobs.
export default async (req) => {
  const user = await getUser(req);
  if (!user) return json(401, { error: "Tu sesión expiró. Vuelve a entrar con tu usuario." });

  const s = store();
  const key = `data/${user}`;

  if (req.method === "GET") {
    const saved = await s.get(key, { type: "json" });
    return json(200, saved ?? { data: null, updatedAt: 0 });
  }

  if (req.method === "PUT") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "Solicitud inválida." });
    }
    const updatedAt = Number(body?.updatedAt) || Date.now();
    if (!body?.data || typeof body.data !== "object") return json(400, { error: "Faltan datos." });

    // Nunca pisar una copia más nueva (por ejemplo, desde otro dispositivo).
    const current = await s.get(key, { type: "json" });
    if (current && current.updatedAt > updatedAt) {
      return json(409, { error: "La nube tiene datos más recientes.", updatedAt: current.updatedAt });
    }

    await s.setJSON(key, { data: body.data, updatedAt });
    // Copia diaria adicional, para poder volver atrás si algo sale mal.
    await s.setJSON(`days/${user}/${new Date(updatedAt).toISOString().slice(0, 10)}`, { data: body.data, updatedAt });
    return json(200, { ok: true, updatedAt });
  }

  return json(405, { error: "Método no permitido." });
};
