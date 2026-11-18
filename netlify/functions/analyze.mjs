import Anthropic from "@anthropic-ai/sdk";
import { guardAI } from "../lib/auth.mjs";

export const config = { path: "/api/analyze" };

const SYSTEM = `Eres un nutricionista experto en estimar calorías y macronutrientes a partir de fotos o descripciones de comidas.

Cómo trabajar:
- Identifica cada alimento o componente visible del plato por separado (por ejemplo: milanesa, puré, ensalada, pan, bebida).
- Estima el peso de cada porción en gramos usando referencias visuales: tamaño del plato, cubiertos, manos, envases.
- Calcula calorías, proteínas, carbohidratos y grasas de cada componente para ESA porción, con valores de tablas de composición de alimentos.
- Incluye las calorías ocultas probables: aceite de cocción, frituras, aderezos, salsas, manteca, azúcar.
- Sé realista y no subestimes: la persona usa estos datos para mantener un déficit calórico, y una estimación baja le perjudica. Ante la duda entre dos valores, elige el intermedio-alto.
- Responde siempre en español, con nombres de alimentos cortos y habituales.
- "confidence" refleja qué tan segura es la estimación: "alta", "media" o "baja".
- En "notes" escribe una sola frase breve con el supuesto más importante que hiciste (por ejemplo, "Asumí que la milanesa está frita"). Déjalo vacío si no hay nada que aclarar.
- Si la imagen o el texto no contienen comida ni bebida, devuelve is_food=false, items vacío y explica en "notes" qué ves.`;

const SCHEMA = {
  type: "object",
  properties: {
    is_food: { type: "boolean" },
    meal_name: { type: "string", description: "Nombre corto del plato completo" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          grams: { type: "number", description: "Peso estimado de la porción en gramos (o ml si es bebida)" },
          calories: { type: "number" },
          protein_g: { type: "number" },
          carbs_g: { type: "number" },
          fat_g: { type: "number" },
        },
        required: ["name", "grams", "calories", "protein_g", "carbs_g", "fat_g"],
        additionalProperties: false,
      },
    },
    confidence: { type: "string", enum: ["alta", "media", "baja"] },
    notes: { type: "string" },
  },
  required: ["is_food", "meal_name", "items", "confidence", "notes"],
  additionalProperties: false,
};

const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });

  if (!process.env.ANTHROPIC_API_KEY) {
    return json(500, { error: "Falta configurar ANTHROPIC_API_KEY en Netlify." });
  }

  // Solo usuarios con sesión, y con un límite diario de análisis.
  const denied = await guardAI(req);
  if (denied) return denied;

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Solicitud inválida." });
  }

  const { image, mediaType, hint } = body ?? {};
  const text = typeof hint === "string" ? hint.trim().slice(0, 500) : "";
  if (!image && !text) return json(400, { error: "Envía una foto o una descripción." });
  if (image && !MEDIA_TYPES.includes(mediaType)) {
    return json(400, { error: "Formato de imagen no soportado." });
  }

  const content = [];
  if (image) {
    content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: image } });
    content.push({
      type: "text",
      text: text
        ? `Analiza esta comida. Aclaración de la persona: "${text}"`
        : "Analiza esta comida.",
    });
  } else {
    content.push({ type: "text", text: `Analiza esta comida descrita por la persona: "${text}"` });
  }

  const client = new Anthropic();

  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      system: SYSTEM,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA },
      },
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") {
      return json(422, { error: "La IA no pudo analizar esta imagen. Prueba con otra foto." });
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
    return json(500, { error: "Error inesperado al analizar la comida." });
  }
};
