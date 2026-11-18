# Kcal IA

Calculadora de calorías con IA: sacas una foto del plato, Claude estima calorías y macros, tú revisas o editas, y se suma a tu contador diario.

## Estructura

- `public/index.html` — toda la app (interfaz, animaciones, lógica y almacenamiento local).
- `netlify/functions/analyze.mjs` — función que llama a Claude para analizar comidas. Tu API key vive aquí, nunca en el navegador.
- `netlify/functions/activity.mjs` — función que llama a Claude para estimar calorías quemadas en actividad física y sugerir ejercicios según hora y clima.
- `netlify.toml`, `package.json` — configuración de Netlify.

## Publicar en Netlify

1. **Consigue tu API key** en https://console.anthropic.com → *API Keys* (requiere cargar crédito).
2. **Sube el proyecto a GitHub**: crea un repositorio nuevo (privado) en https://github.com/new y sube todos estos archivos respetando las carpetas (*Add file → Upload files* admite arrastrar carpetas).
3. **Conecta Netlify**: en https://app.netlify.com → *Add new site → Import an existing project* → elige el repositorio. No cambies nada de la configuración de build y pulsa *Deploy*.
4. **Configura las variables** en *Site configuration → Environment variables*:
   - `ANTHROPIC_API_KEY` — tu key (obligatoria).
   - `APP_PIN` — el **código de invitación** (obligatorio). Solo quien lo tenga puede crear una cuenta, así nadie gasta tu crédito sin permiso.
   - `AI_DAILY_LIMIT` — opcional. Máximo de análisis con IA por usuario y por día (40 si no lo defines).
5. **Vuelve a desplegar** (*Deploys → Trigger deploy*) para que tome las variables.
6. Abre el enlace en el móvil y usa *Compartir → Agregar a inicio* para tenerla como app.

## Probar en local

```bash
python3 -m http.server 8765 --directory public
```

En local no hay función de IA: la app responde con un plato de ejemplo ("modo demo") para poder probar la interfaz.

## Notas

- Modelo: `claude-opus-5-5` con esfuerzo bajo. Se cambia en `analyze.mjs`.
- Cada persona crea su cuenta (usuario y contraseña) con el código de invitación. Sus datos se guardan en su móvil y en Netlify Blobs de tu sitio, separados por usuario, con una copia extra por día. Actualizar la app no borra nada.
- Para invitar a alguien: pásale el enlace del sitio y el código de invitación.
- En Perfil → Tus datos puedes además descargar una copia en un archivo y restaurarla.
- El clima se obtiene de Open-Meteo (gratis, sin API key) con la ubicación del móvil, solo si das permiso. Si no, puedes escribir la temperatura a mano.
- Las calorías de ejercicio son netas (descontando lo que gastarías en reposo) y por defecto se suma la mitad al objetivo del día; se cambia en Perfil.
- Objetivo calórico: Mifflin-St Jeor × nivel de actividad − déficit elegido, con un mínimo de 1500 kcal (hombres) o 1200 kcal (mujeres).
