import { checkPassword, endSession, hashPassword, json, newSession, store } from "../lib/auth.mjs";

export const config = { path: "/api/account" };

const USERNAME = /^[a-z0-9._-]{3,20}$/;
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60 * 1000;

// Borra una sola vez los datos de la versión anterior (una copia compartida para todos).
async function dropLegacy(s) {
  if (await s.get("meta/legacy-cleared")) return;
  await s.delete("backup");
  const { blobs } = await s.list({ prefix: "daily/" });
  for (const b of blobs) await s.delete(b.key);
  await s.set("meta/legacy-cleared", new Date().toISOString());
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Solicitud inválida." });
  }

  const s = store();
  const action = body?.action;

  if (action === "logout") {
    await endSession(req);
    return json(200, { ok: true });
  }

  const username = String(body?.username ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  if (!USERNAME.test(username)) {
    return json(400, { error: "El usuario debe tener de 3 a 20 letras o números, sin espacios." });
  }
  if (password.length < 6 || password.length > 100) {
    return json(400, { error: "La contraseña debe tener al menos 6 caracteres." });
  }

  await dropLegacy(s);
  const key = `users/${username}`;

  if (action === "signup") {
    const invite = process.env.APP_PIN;
    if (!invite) return json(403, { error: "El registro no está habilitado (falta APP_PIN en Netlify)." });
    if (String(body?.invite ?? "").trim() !== invite) {
      return json(403, { error: "El código de invitación no es correcto." });
    }
    if (await s.get(key)) return json(409, { error: "Ese usuario ya existe. Elige otro o entra con tu contraseña." });
    await s.setJSON(key, { username, ...hashPassword(password), fails: 0, lockedUntil: 0, createdAt: Date.now() });
    return json(200, { token: await newSession(username), username });
  }

  if (action === "login") {
    const user = await s.get(key, { type: "json" });
    if (!user) return json(401, { error: "Usuario o contraseña incorrectos." });
    if (user.lockedUntil > Date.now()) {
      return json(429, { error: "Demasiados intentos fallidos. Prueba de nuevo en 15 minutos." });
    }
    if (!checkPassword(password, user)) {
      user.fails = (user.fails || 0) + 1;
      if (user.fails >= MAX_FAILS) {
        user.fails = 0;
        user.lockedUntil = Date.now() + LOCK_MS;
      }
      await s.setJSON(key, user);
      return json(401, { error: "Usuario o contraseña incorrectos." });
    }
    if (user.fails) await s.setJSON(key, { ...user, fails: 0 });
    return json(200, { token: await newSession(username), username });
  }

  return json(400, { error: "Acción desconocida." });
};
