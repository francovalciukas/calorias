import { getStore } from "@netlify/blobs";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const store = () => getStore({ name: "kcal-ia", consistency: "strong" });

export const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const sha = (s) => createHash("sha256").update(s).digest("hex");

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(password, salt, 64).toString("hex") };
}

export function checkPassword(password, user) {
  const got = scryptSync(password, user.salt, 64);
  const want = Buffer.from(user.hash, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function newSession(username) {
  const token = randomBytes(32).toString("base64url");
  await store().setJSON(`sessions/${sha(token)}`, { user: username, createdAt: Date.now() });
  return token;
}

const bearer = (req) => /^Bearer (\S+)$/.exec(req.headers.get("authorization") || "")?.[1];

// Devuelve el usuario de la sesión, o null si no hay sesión válida.
export async function getUser(req) {
  const token = bearer(req);
  if (!token) return null;
  const session = await store().get(`sessions/${sha(token)}`, { type: "json" });
  return session?.user ?? null;
}

export async function endSession(req) {
  const token = bearer(req);
  if (token) await store().delete(`sessions/${sha(token)}`);
}

// Límite diario de análisis con IA por usuario, para cuidar el crédito de la API.
export async function allowAI(user) {
  const limit = Number(process.env.AI_DAILY_LIMIT) || 40;
  const key = `usage/${user}/${new Date().toISOString().slice(0, 10)}`;
  const s = store();
  const n = (await s.get(key, { type: "json" }))?.n ?? 0;
  if (n >= limit) return false;
  await s.setJSON(key, { n: n + 1 });
  return true;
}

// Comprobación común para las funciones que usan la IA.
export async function guardAI(req) {
  const user = await getUser(req);
  if (!user) return json(401, { error: "Tu sesión expiró. Vuelve a entrar con tu usuario." });
  if (!(await allowAI(user))) {
    return json(429, { error: "Llegaste al límite de análisis con IA de hoy. Mañana se renueva." });
  }
  return null;
}
