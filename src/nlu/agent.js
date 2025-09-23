const OpenAI = require('openai');
const { logger } = require('../utils/logger');
const { findProducts, readStock } = require('../sheets/stock');
const { checkAvailability } = require('../sheets/availability');
const { createReservation } = require('../sheets/reservations');
const { readBotConfig } = require('../sheets/config');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// --------------- helpers ---------------
function isGreeting(text='') {
  const t = text.toLowerCase().trim();
  return /^(hola|buenas|buen día|buen dia|buenas tardes|buenas noches|qué tal|que tal)\b/.test(t);
}
function includesWord(text='', word='') {
  return (` ${text.toLowerCase()} `).includes(` ${word.toLowerCase()} `);
}

// --------------- tools ---------------
const TOOL_DEFS = {
  search_products: {
    type: "function",
    function: {
      name: "search_products",
      description: "Buscar productos por texto y/o categoría.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, category: { type: "string" } }
      }
    }
  },
  check_availability: {
    type: "function",
    function: {
      name: "check_availability",
      description: "Chequear disponibilidad (agenda).",
      parameters: {
        type: "object",
        properties: { date:{type:"string"}, time:{type:"string"}, people:{type:"number"} },
        required: ["date","time","people"]
      }
    }
  },
  create_reservation: {
    type: "function",
    function: {
      name: "create_reservation",
      description: "Crear reserva (no cobra).",
      parameters: {
        type: "object",
        properties: { name:{type:"string"}, phone:{type:"string"}, date:{type:"string"}, time:{type:"string"}, people:{type:"number"}, notes:{type:"string"} },
        required: ["date","time","people"]
      }
    }
  }
};

function buildToolsByRole(role) {
  const r = (role || 'mixto').toLowerCase();
  if (r === 'ventas') return [TOOL_DEFS.search_products];
  if (r === 'reservas') return [TOOL_DEFS.check_availability, TOOL_DEFS.create_reservation];
  return [TOOL_DEFS.search_products, TOOL_DEFS.check_availability, TOOL_DEFS.create_reservation];
}

// --------------- router ---------------
async function toolRouter(name, args, ctx) {
  switch (name) {
    case 'search_products': {
      const list = await findProducts(args.query || '', args.category || '');
      const trimmed = list.slice(0, 8).map(p => ({
        sku: p.sku, name: p.name, variant: p.variant, price: p.price,
        qty_available: p.qty_available, image_url: p.image_url || '', categories: p.categories || ''
      }));
      if (trimmed[0]) ctx.session.last_product = trimmed[0].name;
      return { ok: true, results: trimmed };
    }
    case 'check_availability': {
      const out = await checkAvailability(args.date, args.time, args.people);
      return { ok: true, ...out };
    }
    case 'create_reservation': {
      const out = await createReservation(args);
      ctx.session.reservation = { ...args, id: out.id, status: out.status };
      return { ok: true, reservation: ctx.session.reservation };
    }
    default: return { ok: false, error: 'unknown_tool' };
  }
}

// --------------- prompts ---------------
function buildNLUPrompt({ text, cfg, role }) {
  const categories = cfg.categories ? Object.keys(cfg.categories).join(', ') : '';
  return `Responde solo JSON con {"intent":"...","product_category":"","product_query":"","confidence":0..1}.
- intent ∈ {"consulta_stock","reserva","saludo","fallback"}
- product_category ∈ {${categories}} o ""
- product_query: término libre si se menciona producto
Texto: """${text}"""
Rol del agente: ${role}`;
}

// --------------- agente ---------------
async function runAgent({ userCtx, session, text, viewMode }) {
  if (!process.env.OPENAI_API_KEY) return null;

  const cfg = await readBotConfig();
  const role = (cfg.agent_role || 'mixto').toLowerCase();
  const tools = buildToolsByRole(role);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Saludo rápido
  if (isGreeting(text)) {
    const msg = (cfg.greeting_template || 'Hola').replace('{{bot_name}}', cfg.bot_name || 'Bot');
    return { text: msg, session };
  }

  // Paso 1: NLU
  const nluRes = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: "Responde solo JSON válido." },
      { role: "user", content: buildNLUPrompt({ text, cfg, role }) }
    ],
    temperature: 0.1,
    max_tokens: 120
  });

  let nlu = {};
  try { nlu = JSON.parse(nluRes.choices?.[0]?.message?.content || "{}"); } catch {}
  let intent = nlu.intent || 'fallback';
  const product_category = (nlu.product_category || '').toLowerCase();
  const product_query = nlu.product_query || text;

  if (intent === 'fallback' && isGreeting(text)) intent = 'saludo';
  const mode = ((viewMode || cfg.response_mode || 'concise') + '').toLowerCase();

  const wantsProducts = intent === 'consulta_stock' || /precio|stock|producto|milanesa|bife|vacio|empanizado/i.test(text);
  const wantsReservation = intent === 'reserva' || /reserva|turno|disponibilidad|agenda/i.test(text);

  // --- Rescate en fallback ---
  if (intent === 'fallback') {
    const seemsProduct = wantsProducts || /milanesa|milanesas|bife|vac(i|í)o|empanizado|empanizados|precio|stock|cat[aá]logo/i.test(text);
    if (seemsProduct) {
      logger.info({ text }, 'Fallback rescue activado');
      try {
        const list = await findProducts(product_query, product_category);
        if (list && list.length) {
          const p = list[0];
          const oos = (p.qty_available || 0) <= 0;
          const line = oos
            ? (cfg.oos_template || 'No lo tengo ahora mismo.').replace('{{product}}', p.name)
            : `${p.name}${p.variant ? ` (${p.variant})` : ''} — $${p.price} | Stock: ${p.qty_available}`;
          return {
            text: line,
            session: { ...session, last_product: p.name },
            rich: (!oos && p.image_url) ? { image_url: p.image_url, caption: `${p.name} — $${p.price}` } : undefined
          };
        }
      } catch (e) {
        logger.warn({ e }, 'fallback rescue failed');
      }
    }
  }

  // Guardrails
  if (role === 'ventas' && wantsReservation) {
    return { text: "Soy agente de ventas. Para reservas, decime fecha/hora/personas y te derivo.", session };
  }
  if (role === 'reservas' && wantsProducts) {
    return { text: "Soy agente de reservas. Para precios o stock, te puedo derivar con ventas.", session };
  }

  // —— INTENTS —— //
  if (intent === 'saludo') {
    const msg = (cfg.greeting_template || 'Hola').replace('{{bot_name}}', cfg.bot_name || 'Bot');
    return { text: msg, session };
  }

  if (intent === 'consulta_stock' && role !== 'reservas') {
    const list = (await toolRouter('search_products', { query: product_query, category: product_category }, { session })).results || [];
    const all = await readStock();

    // match “milanesa” literal
    const lowerText = text.toLowerCase();
    const exactMention = all.find(p =>
      (includesWord(lowerText, 'milanesa') || includesWord(lowerText, 'milanesas')) &&
      p.name.toLowerCase().includes('milanesa')
    );
    if (exactMention) {
      const p = exactMention;
      const priceLine = `${p.name}${p.variant ? ` (${p.variant})` : ''} está a $${p.price}${p.qty_available>0?` | Stock: ${p.qty_available}`:' | ahora sin stock'}.`;
      return { text: priceLine, session };
    }

    if (product_category) {
      const withStock = list.filter(x => x.qty_available > 0);
      if (withStock.length) {
        const top = withStock[0];
        return { text: `Sí, tenemos ${product_category}: ${top.name} — $${top.price} (stock ${top.qty_available})`, session };
      }
    }

    if (list.length) {
      const top = list[0];
      return { text: `${top.name} — $${top.price} | Stock: ${top.qty_available}`, session };
    }

    return { text: "No encontré ese producto. ¿Querés otra palabra o alternativa?", session };
  }

  if (intent === 'reserva' && role !== 'ventas') {
    return { text: "Confirmame fecha (YYYY-MM-DD), hora (HH:mm) y cuántas personas, y lo reviso.", session };
  }

  // fallback elegante
  if (role === 'ventas') {
    return { text: "¿Sobre qué producto te ayudo? Podés pedir por categoría (ej.: empanizados) o por nombre (ej.: milanesa).", session };
  }
  if (role === 'reservas') {
    return { text: "¿Para qué fecha y hora querés reservar y para cuántas personas? Reviso disponibilidad.", session };
  }
  return { text: "¿Sobre qué producto o reserva te ayudo? Podés pedir por categoría (ej.: empanizados) o por nombre (ej.: milanesa).", session };
}

module.exports = { runAgent };
