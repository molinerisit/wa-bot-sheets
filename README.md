# WhatsApp Bot + Google Sheets

Bot de WhatsApp usando **Evolution API** como proveedor y **Google Sheets** como base de datos editable
(`stock` + `config`), con motorcito de intents por keywords y CRUD básico de stock.

## 🚀 Quickstart

1) **Instalar dependencias**
```bash
npm i
cp .env.example .env
```

2) **Credenciales**- Configurá Evolution API: `EVO_URL`, `EVO_TOKEN`, `EVO_INSTANCE`.- Creá una **Service Account** en Google Cloud y compartí el **Spreadsheet** con su email.- Pegá `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY` (con `\n` escapados), y `SPREADSHEET_ID` en `.env`.

3) **Google Sheets – Plantillas**- Hoja `stock` (A:K):

| sku | name | variant | qty_available | price | cost | min_qty | status | location | image_url | last_updated |
|---|---|---|---:|---:|---:|---:|---|---|---|---|
| CG-001 | Bife de chorizo | 500g | 12 | 5500 | 3800 | 3 | active | tienda | https://... | 2025-09-22 10:31 |

- Hoja `config` (A:B):

| key | value |
|-----|-------|
| bot_name | "Orbytal Bot" |
| language | "es-AR" |
| timezone | "America/Argentina/Cordoba" |
| greeting_template | "¡Hola! Soy {{bot_name}}. ¿Qué buscás hoy?" |
| oos_template | "Ahora no tengo {{product}}. ¿Querés que te avise?" |
| intents | [{"name":"consulta_stock","examples":["tenés","stock","precio"]}] |
| synonyms | {"bife":["bife de chorizo","entrecot"]} |

4) **Arrancar**
```bash
npm run dev
```

5) **Configurar Webhook en Evolution API**Apuntá el webhook entrante de Evolution a:
```
POST http://TU_HOST:3000/wa/webhook
Header: apikey: <EVO_TOKEN>   (si Evolution lo reenvía, no es obligatorio para nuestro endpoint)
```
> El endpoint **no** requiere firma; si querés, limitá por IP o agrega `WEBHOOK_TOKEN` como query `?token=evolution`

6) **Probar mensajes**Enviá un mensaje que contenga la palabra "bife" al número conectado. El bot buscará en `stock` y responderá precio y stock.


## 🧩 Estructura

```
src/
  server.js            # Express + rutas
  evo.js               # Cliente Evolution (sendText, sendMedia)
  routes-bot.js        # Endpoints admin (CRUD stock)
  bot/
    engine.js          # Intent por keywords + flujo stock
  sheets/
    sheets.js          # Cliente Google Sheets (JWT service account)
    stock.js           # CRUD sobre hoja stock
    config.js          # Lectura de config (clave/valor - JSON)
  utils/
    logger.js          # Logger pino
```

## 🔐 Notas
- **GOOGLE_PRIVATE_KEY** debe ir con saltos de línea escapados `\n` dentro de comillas.
- Compartí el **Spreadsheet** con `GOOGLE_CLIENT_EMAIL`.
- Si vas a producción, agregá **Redis** para cache y **rate limits** a `/wa/webhook`.

## 🧭 Endpoints
- `POST /wa/webhook`  → recibe mensajes de Evolution y responde por la misma API.
- `GET  /admin/stock` → lista stock (JSON).
- `POST /admin/stock` → `{ "sku": "CG-001", "patch": { "qty_available": 8 } }`

## 🛠️ Extensiones sugeridas
- Import/Export CSV.
- Carrito persistente (Redis).
- Reglas de descuento y horarios desde `config`.
- Catálogo por categorías y sinónimos expandidos.
