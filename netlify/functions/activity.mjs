import Anthropic from "@anthropic-ai/sdk";

export const config = { path: "/api/activity" };

const COMMON = `Eres fisiólogo del ejercicio y nutricionista deportivo. Ayudas a una persona que quiere bajar de peso manteniendo un déficit calórico.

Reglas de cálculo:
- Estima el gasto con valores MET del Compendium of Physical Activities, el peso de la persona y la duración.
- Informa SIEMPRE calorías NETAS: (MET − 1) × kg × horas. El gasto en reposo de ese tiempo ya está incluido en su objetivo diario, así que no debe contarse dos veces.
- Ajusta por edad y sexo de forma moderada.
- Calor: por encima de 27 °C suben el pulso y el esfuerzo percibido, pero el gasto calórico extra es pequeño (como mucho un 5–10 %). Úsalo para la intensidad y los consejos de hidratación; no infles las calorías.
- Sé prudente: las tablas y los relojes deportivos suelen sobrestimar. Ante la duda, elige el valor medio-bajo.
- Responde en español, con frases cortas y nombres de actividades habituales.`;

const ESTIMATE = `${COMMON}

Tarea: la persona te cuenta qué actividad física hizo. Separa cada actividad distinta (por ejemplo, caminata y pesas). Si no dice la duración, asume una típica y acláralo en "notes". La intensidad es "baja", "moderada" o "alta".
"notes": una frase con el supuesto principal, o vacío si no hace falta.
"tip": un consejo breve y concreto para hoy según el clima, la hora y lo que hizo (hidratación, recuperación, proteína). Vacío si no aporta nada.
Si el texto no describe actividad física, devuelve is_activity=false, activities vacío y explica en "notes".`;

const SUGGEST = `${COMMON}

Tarea: sugiere 3 actividades realistas que la persona pueda hacer hoy, distintas entre sí (por ejemplo, una al aire libre, una en casa y una de fuerza). Ten en cuenta la fecha, la hora, la estación, el clima, lo que ya hizo hoy y las calorías que le quedan. Con calor, evita el ejercicio intenso al aire libre entre las 11 y las 17 h y propone horarios o lugares más frescos. Si ya es de noche, propone opciones suaves que no afecten el sueño. Nada que requiera equipamiento especial.
"why": una frase sobre por qué conviene hoy.
"tip": un consejo general breve para hoy (hidratación, horario, etc.).`;

const INTENSITY = { type: "string", enum: ["baja", "moderada", "alta"] };

const ESTIMATE_SCHEMA = {
  type: "object",
  properties: {
    is_activity: { type: "boolean" },
    activities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          minutes: { type: "number" },
          intensity: INTENSITY,
          calories: { type: "number", description: "Calorías netas quemadas" },
        },
        required: ["name", "minutes", "intensity", "calories"],
        additionalProperties: false,
      },
    },
    notes: { type: "string" },
    tip: { type: "string" },
  },
  required: ["is_activity", "activities", "notes", "tip"],
  additionalProperties: false,
};

const SUGGEST_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          minutes: { type: "number" },
          intensity: INTENSITY,
          calories: { type: "number", description: "Calorías netas estimadas" },
          why: { type: "string" },
        },
        required: ["name", "minutes", "intensity", "calories", "why"],
        additionalProperties: false,
      },
    },
    tip: { type: "string" },
  },
  required: ["suggestions", "tip"],
  additionalProperties: false,
};

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const num = (v, min, max) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};
const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");

function context(b) {
  const p = b.profile ?? {};
  const age = num(p.age, 10, 100);
  const kg = num(p.weight, 30, 300);
  const cm = num(p.height, 120, 230);
  const lines = [
    `Persona: ${p.sex === "f" ? "mujer" : "hombre"}${age ? `, ${age} años` : ""}${kg ? `, ${kg} kg` : ""}${cm ? `, ${cm} cm` : ""}.`,
  ];
  const when = str(b.when, 80);
  if (when) lines.push(`Fecha y hora: ${when}.`);
  const t = num(b.temp, -30, 55);
  const h = num(b.humidity, 0, 100);
  if (t !== null) lines.push(`Temperatura: ${t} °C${h !== null ? `, humedad ${h} %` : ""}.`);
  if (b.hemisphere === "sur" || b.hemisphere === "norte") lines.push(`Hemisferio ${b.hemisphere}.`);
  return lines.join("\n");
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });

  if (!process.env.ANTHROPIC_API_KEY) {
    return json(500, { error: "Falta configurar ANTHROPIC_API_KEY en Netlify." });
  }

  const pin = process.env.APP_PIN;
  if (pin && req.headers.get("x-app-pin") !== pin) {
    return json(401, { error: "Código de acceso incorrecto. Revísalo en Perfil." });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Solicitud inválida." });
  }
  body = body ?? {};

  let system, schema, prompt;
  if (body.mode === "suggest") {
    system = SUGGEST;
    schema = SUGGEST_SCHEMA;
    const remaining = num(body.remaining, -5000, 10000);
    const done = Array.isArray(body.done) ? body.done.map((d) => str(d, 80)).filter(Boolean).slice(0, 10) : [];
    prompt = `${context(body)}
${remaining !== null ? `Calorías que le quedan hoy para su objetivo: ${Math.round(remaining)} kcal.` : ""}
Actividad ya registrada hoy: ${done.length ? done.join("; ") : "ninguna"}.

¿Qué actividad física me recomiendas hacer hoy?`;
  } else {
    const text = str(body.text, 600);
    if (!text) return json(400, { error: "Cuéntame qué actividad hiciste." });
    system = ESTIMATE;
    schema = ESTIMATE_SCHEMA;
    prompt = `${context(body)}

Lo que hice: "${text}"`;
  }

  const client = new Anthropic();

  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      system,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema },
      },
      messages: [{ role: "user", content: prompt }],
    });

    if (response.stop_reason === "refusal") {
      return json(422, { error: "La IA no pudo procesar esta solicitud." });
    }
    if (response.stop_reason === "max_tokens") {
      return json(502, { error: "La respuesta quedó incompleta. Inténtalo de nuevo." });
    }

    const block = response.content.find((b) => b.type === "text");
    if (!block) return json(502, { error: "La IA no devolvió un resultado." });

    return json(200, JSON.parse(block.text));
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return json(500, { error: "La API key de Anthropic no es válida." });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return json(429, { error: "Demasiadas solicitudes. Espera unos segundos y reintenta." });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("Anthropic API error", err.status, err.message);
      return json(502, { error: `Error de la IA (${err.status ?? "red"}). Inténtalo de nuevo.` });
    }
    console.error(err);
    return json(500, { error: "Error inesperado al procesar la actividad." });
  }
};
