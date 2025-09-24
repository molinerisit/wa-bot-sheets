
# Bot Platform (Sequelize + PostgreSQL + OpenAI)

**Objetivo:** darte una base clara, modular y *editable* para que el bot no entre en loops, tenga estados simples y puedas cambiar cada parte sin perderte.

## Estructura
```
src/
  bot/
    engine.js      # orquesta turnos, LLM parser y acciones
    nlu.js         # intents por diccionario + sinónimos
    nlg.js         # plantillas
    shop.js        # catálogo + reglas
  sql/
    db.js          # conexión y esquemas
    models/
      index.js     # modelos Sequelize (bot.*, shop.*)
  web/
    routes/
      bot.js       # /bot/webhook
      config.js    # /config (get/post)
      admin.js     # /admin/* (CRUD simple)
    index.js
```

## Setup local
```bash
cp .env.example .env  # edita DATABASE_URL y OPENAI_API_KEY
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

## Probar rápido
```bash
curl -XPOST http://localhost:8080/bot/webhook -H "Content-Type: application/json"   -d '{"channel":"web","user_id":"julian","text":"tenés milanesas?"}'
```

## Anti-loops
- Límite de turnos por conversación (`BOT_MAX_TURNS`)
- Parser estructurado con OpenAI + Zod (si falla, usa NLU por diccionario)

## Dónde tocar qué
- **Saludo, OOS, role, timezone, etc.:** tabla `bot.configs` o `POST /config`
- **Intents/sinónimos/categorías:** `/admin/*`
- **Reglas de negocio:** `bot.rules` JSON. Ej.: `{"when":{"category":"Carnes"}, "action":{"discount_pct":10}}`
- **Catálogo simulado (shop):** `shop.products` o `/admin/products`

## Railway (resumen)
1. Servicio Web (Node) + servicio PostgreSQL.
2. Variables: `DATABASE_URL`, `OPENAI_API_KEY`, `PORT=8080`.
3. Ejecutá migraciones y seeders.
4. Apuntá tu WhatsApp webhook o frontend a `POST /bot/webhook`.

> Si querés separar en dos DB reales (bot vs e-commerce), duplicá el conector y models con un segundo `sequelize` y `DATABASE_URL_2`. Este repo usa dos **esquemas** para simplificar.


## Seguridad básica
- Todas las rutas `/config` y `/admin/*` exigen header `x-admin-token`.
- Definí `ADMIN_TOKEN` en Railway y pegalo en el campo del panel `/ui/admin.html`.


## RAG (pgvector) + Conector externo
- Migración activa `EXTENSION vector` y crea `rag.documents`/`rag.chunks` con embeddings (text-embedding-3-small).
- UI: `/ui/rag.html` para subir texto, listar y borrar docs.
- Política del bot: **responder solo con lo que hay en RAG**. Si no está, dice que no tiene esa info cargada.
- Conector DB externa (solo lectura): guarda `external_db_url` y `external_allowed_sql` en `bot.configs`.
  El motor solo ejecuta **SELECT whitelisteados**.
