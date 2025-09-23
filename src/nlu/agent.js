const OpenAI = require('openai');
const { logger } = require('../utils/logger');
const { findProducts } = require('../sheets/stock');
const { checkAvailability } = require('../sheets/availability');
const { createReservation } = require('../sheets/reservations');
const { readBotConfig } = require('../sheets/config');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const tools = [
  {
    type: "function",
    function: {
      name: "search_products",
      description: "Buscar productos por texto libre y/o categoría normalizada. Devuelve lista con nombre, precio y stock.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          category: { type: "string", description: "categoría normalizada (ej.: empanizado, carne)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "check_availability",
      description: "Chequear disponibilidad para fecha/hora/personas.",
      parameters: {
        type: "object",
        properties: { date:{type:"string"}, time:{type:"string"}, people:{type:"number"} },
        required: ["date","time","people"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_reservation",
      description: "Crear una reserva (no cobra).",
      parameters: {
        type: "object",
        properties: { name:{type:"string"}, phone:{type:"string"}, date:{type:"string"}, time:{type:"string"}, people:{type:"number"}, notes:{type:"string"} },
        required: ["date","time","people"]
      }
    }
  }
];

async function searchProductsTool(args, ctx) {
  const list = await findProducts(args.query || '', args.category || '');
  const trimmed = list.slice(0, 5).map(p => ({
    sku: p.sku,
    name: p.name,
    variant: p.variant,
    price: p.price,
    qty_available: p.qty_available,
    image_url: p.image_url || '',
    categories: p.categories || ''
  }));
  if (trimmed[0]) ctx.session.last_product = trimmed[0].name;
  return { ok: true, results: trimmed };
}

async function toolRouter(name, args, ctx) {
  switch (name) {
    case 'search_products': return searchProductsTool(args, ctx);
    case 'check_availability': return { ok: true, ...(await checkAvailability(args.date, args.time, args.people)) };
    case 'create_reservation': {
      const out = await createReservation(args);
      ctx.session.reservation = { ...args, id: out.id, status: out.status };
      return { ok: true, reservation: ctx.session.reservation };
    }
    default: return { ok: false, error: 'unknown_tool' };
  }
}

function businessPolicyText(cfg) {
  const hours = typeof cfg.business_hours === 'object' ? JSON.stringify(cfg.business_hours) : String(cfg.business_hours || '');
  return [
    `Horario: ${hours || 'no especificado'}.`,
    `No vendes ni cobrás; si piden comprar, derivás al e-commerce (${cfg.ecommerce_url || 'sin URL'}).`,
    `Si piden stock sin producto, pedí el producto o la categoría.`,
    `Usá categoría si la consulta es genérica (ej.: "empanizado").`
  ].join(' ');
}

function buildNLUPrompt({ text, cfg }) {
  const categories = cfg.categories ? Object.keys(cfg.categories).join(', ') : '';
  return `Devuelve solo JSON con: { "intent": "...", "product_category": "", "product_query": "", "confidence": 0..1 }.
- intent ∈ {"consulta_stock","reserva","fallback"}
- product_category ∈ {${categories}} o "" si no aplica
- product_query: término libre normalizado (si menciona un producto puntual)
Texto: """${text}"""`;
}

async function runAgent({ userCtx, session, text }) {
  if (!process.env.OPENAI_API_KEY) return null;

  const cfg = await readBotConfig();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const system = [
    "Asistente en español rioplatense; rol: asesor/secretario.",
    "Responde sobre productos (precio/stock/detalles) y agenda/reservas.",
    "No vendas ni cobres. Pedí aclaraciones cuando falten datos.",
    businessPolicyText(cfg)
  ].join(' ');

  const nluPrompt = buildNLUPrompt({ text, cfg });

  // Paso 1: NLU estructurado
  const nluRes = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: "Responde solo JSON válido." },
      { role: "user", content: nluPrompt }
    ],
    temperature: 0.1,
    max_tokens: 120
  });

  let nlu = {};
  try { nlu = JSON.parse(nluRes.choices?.[0]?.message?.content || "{}"); } catch {}
  const intent = nlu.intent || 'fallback';
  const product_category = (nlu.product_category || '').toLowerCase();
  const product_query = nlu.product_query || text;

  // Paso 2: si es consulta de stock -> usar herramienta de productos
  const messages = [
    { role: "system", content: system },
    ...(session.history || []).slice(-6),
    { role: "user", content: text }
  ];
  const ctx = { session };

  if (intent === 'consulta_stock') {
    // llamar a la tool con categoría y/o query
    const results = await searchProductsTool({ query: product_query, category: product_category }, ctx);

    const mode = (cfg.response_mode || 'concise').toLowerCase();
    const items = results.results || [];

    if (!items.length) {
      return { text: "No encontré nada en esa categoría/producto. ¿Querés que busque otra cosa o un corte similar?", session: ctx.session };
    }

    // Elegir el mejor (prioriza con stock)
    const top = items[0];

    if (mode === 'concise') {
      // Respuesta humana corta
      if (product_category) {
        // si viene categoría genérica
        const conStock = items.find(x => x.qty_available > 0);
        if (conStock) {
          return { text: `Sí, tenemos ${product_category}. Por ejemplo, ${conStock.name}${conStock.variant ? ` (${conStock.variant})` : ''} a $${conStock.price}. ¿Querés ver otra opción?`, session: ctx.session };
        }
        return { text: `Tenemos ${product_category}, pero ahora mismo sin stock disponible. ¿Querés que te avise cuando repongamos o te sugiero algo similar?`, session: ctx.session };
      }
      // producto puntual
      const sufStock = top.qty_available > 0 ? ` | Stock: ${top.qty_available}` : ` | sin stock ahora`;
      return { text: `${top.name}${top.variant ? ` (${top.variant})` : ''} está a $${top.price}${sufStock}.`, session: ctx.session };
    }

    // modo "rich": imagen + listado breve
    const header = product_category
      ? `Opciones en ${product_category}:`
      : `Te dejo una opción:`;

    let caption = `${top.name}${top.variant ? ` (${top.variant})` : ''} — $${top.price} | Stock: ${top.qty_available}`;
    // devolvemos el texto; el envío de imagen lo maneja engine con sendMedia si querés.
    const list = items.slice(0,3).map(x => `• ${x.name}${x.variant?` (${x.variant})`:''}: $${x.price} ${x.qty_available>0?`(stock ${x.qty_available})`:'(sin stock)'}`).join('\n');

    return { text: `${header}\n${list}\n\n¿Te paso más opciones o querés reservar?`, session: ctx.session, rich: { image_url: top.image_url, caption } };
  }

  // (Reserva y fallback igual que antes; omitido aquí por brevedad)
  return { text: "¿Sobre qué producto o reserva te gustaría que te ayude?", session: ctx.session };
}

module.exports = { runAgent };
