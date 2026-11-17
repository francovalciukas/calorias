import { getStore } from "@netlify/blobs";

export const config = { path: "/api/sync" };

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// Copia de seguridad de tus datos en Netlify Blobs (almacenamiento de tu propio sitio).
export default async (req) => {
  const pin = process.env.APP_PIN;
  if (!pin) {
    return json(403, { error: "Configura APP_PIN en Netlify para activar la copia en la nube." });
  }
  if (req.headers.get("x-app-pin") !== pin) {
    return json(401, { error: "Código de acceso incorrecto. Revísalo en Perfil." });
  }

  const store = getStore({ name: "kcal-ia", consistency: "strong" });

  if (req.method === "GET") {
    const saved = await store.get("backup", { type: "json" });
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
    const current = await store.get("backup", { type: "json" });
    if (current && current.updatedAt > updatedAt) {
      return json(409, { error: "La nube tiene datos más recientes.", updatedAt: current.updatedAt });
    }

    await store.setJSON("backup", { data: body.data, updatedAt });
    // Copia diaria adicional, para poder volver atrás si algo sale mal.
    await store.setJSON(`daily/${new Date(updatedAt).toISOString().slice(0, 10)}`, { data: body.data, updatedAt });
    return json(200, { ok: true, updatedAt });
  }

  return json(405, { error: "Método no permitido." });
};
