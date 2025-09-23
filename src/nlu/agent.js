const OpenAI = require('openai');
const { logger } = require('../utils/logger');
const { findProducts, readStock } = require('../sheets/stock');
const { checkAvailability } = require('../sheets/availability');
const { createReservation } = require('../sheets/reservations');
const { readBotConfig } = require('../sheets/config');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// --------------- helpers de texto ---------------
function isGreeting(text='') {
  const t = text.toLowerCase().trim();
  return /^(hola|buenas|buen día|buen dia|buenas tardes|buenas noches|qué tal|que tal)\b/.test(t);
}
function includesWord(text='', word='') {
  return (` ${text.toLowerCase()} `).includes(` ${word.toLowerCase()} `);
}

// --------------- tools (definiciones) ---------------
const TOOL_DEFS = {
  search_products: {
    type: "function",
    function: {
      name: "search_products",
      description: "Buscar productos por texto y/o categoría. Devuelve lista con nombre, precio, stock, imagen.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          category: { type: "string" }
        }
      }
    }
  },
  check_availability: {
    type: "function",
    function: {
      name: "check_availability",
      description: "Chequear disponibilidad (agenda) para fecha/hora/personas.",
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

// Construye el set de herramientas según el rol
function buildToolsByRole(role) {
  const r = (role || 'mixto').toLowerCase();
  if (r === 'ventas') {
    return [TOOL_DEFS.search_products];
  }
  if (r === 'reservas') {
    return [TOOL_DEFS.check_availability, TOOL_DEFS.create_reservation];
  }
  // mixto
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
    default:
      return { ok: false, error: 'unknown_tool' };
  }
}

// --------------- prompts ---------------
function businessPolicyText(cfg, role) {
  const hours = typeof cfg.business_hours === 'object' ? JSON.stringify(cfg.business_hours) : String(cfg.business_hours || '');
  const base = [
    `Horario: ${hours || 'no especificado'}.`,
    `Zona horaria: ${cfg.timezone || 'America/Argentina/Cordoba'}.`,
    `No vendes ni cobrás; si piden comprar, derivás al e-commerce (${cfg.ecommerce_url || 'sin URL'}).`,
  ];
  if (role === 'ventas') {
    base.push(
      `Tu foco: responder sobre productos (precio, stock, detalles).`,
      `No ofrezcas reservas; si preguntan por turnos, indicá que solo asesorás en productos y derivá al canal de reservas si existe.`
    );
  } else if (role === 'reservas') {
    base.push(
      `Tu foco: disponibilidad y reservas.`,
      `No hables de precios/stock de productos; si consultan por productos, aclarar que sos agente de reservas y ofrecer derivar al canal de ventas.`
    );
  } else {
    base.push(
      `Tu foco: productos y reservas. Si falta información (producto, fecha/hora/personas), pedí aclaraciones.`
    );
  }
  base.push(`Si piden stock sin producto, pedí el producto o la categoría (ej.: "empanizado").`);
  return base.join(' ');
}

function buildNLUPrompt({ text, cfg, role }) {
  const categories = cfg.categories ? Object.keys(cfg.categories).join(', ') : '';
  // Permitimos que el NLU clasifique saludos, consulta de producto o de reserva:
  return `Responde solo JSON con {"intent":"...","product_category":"","product_query":"","confidence":0..1}.
- intent ∈ {"consulta_stock","reserva","saludo","fallback"}
- product_category ∈ {${categories}} o ""
- product_query: término libre si se menciona producto
Texto: """${text}"""
Rol del agente: ${role}`;
}

// --------------- agente principal ---------------
async function runAgent({ userCtx, session, text, viewMode }) {
  if (!process.env.OPENAI_API_KEY) return null;

  const cfg = await readBotConfig();
  const role = (cfg.agent_role || 'mixto').toLowerCase(); // ventas | reservas | mixto
  const tools = buildToolsByRole(role);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Saludo rápido sin pedir tools
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

  // Guardrails por rol
  const wantsProducts = intent === 'consulta_stock' || /precio|stock|producto|milanesa|bife|vacio|empanizado/i.test(text);
  const wantsReservation = intent === 'reserva' || /reserva|turno|disponibilidad|agenda/i.test(text);

  if (role === 'ventas' && wantsReservation) {
    return { text: "Soy agente de ventas. Para reservas, decime fecha/hora/personas y te derivo, o escribime por el canal de reservas.", session };
  }
  if (role === 'reservas' && wantsProducts) {
    return { text: "Soy agente de reservas. Para precios o stock, te puedo derivar con ventas o contame la fecha/hora que te interesan y reviso disponibilidad.", session };
  }

  // —— INTENTS —— //
  if (intent === 'saludo') {
    const msg = (cfg.greeting_template || 'Hola').replace('{{bot_name}}', cfg.bot_name || 'Bot');
    return { text: msg, session };
  }

  if (intent === 'consulta_stock' && role !== 'reservas') {
    // productos
    const list = (await toolRouter('search_products', { query: product_query, category: product_category }, { session })).results || [];

    // Si no hubo matches con stock, intentemos precio del mencionado
    const all = await readStock();

    // ¿Mención explícita de milanesa u otro?
    const lowerText = text.toLowerCase();
    // ejemplo puntual para milanesa (podés expandir si querés)
    const exactMention = all.find(p =>
      (includesWord(lowerText, 'milanesa') || includesWord(lowerText, 'milanesas')) &&
      p.name.toLowerCase().includes('milanesa')
    );

    if (exactMention) {
      const p = exactMention;
      const priceLine = `${p.name}${p.variant ? ` (${p.variant})` : ''} está a $${p.price}${p.qty_available>0?` | Stock: ${p.qty_available}`:' | ahora sin stock'}.`;
      if (mode === 'rich' && p.image_url) {
        return {
          text: priceLine + ' ¿Querés que te recomiende algo similar?',
          session,
          rich: { image_url: p.image_url, caption: priceLine }
        };
      }
      return { text: priceLine + ' ¿Querés que te recomiende algo similar?', session };
    }

    // Categoría genérica (“empanizado”)
    if (product_category) {
      const withStock = list.filter(x => x.qty_available > 0);
      if (withStock.length) {
        const top = withStock[0];
        if (mode === 'rich' && top.image_url) {
          const caption = `${top.name}${top.variant?` (${top.variant})`:''} — $${top.price} | Stock: ${top.qty_available}`;
          const lines = withStock.slice(0,3).map(x => `• ${x.name}${x.variant?` (${x.variant})`:''}: $${x.price} ${x.qty_available>0?`(stock ${x.qty_available})`:'(sin stock)'}`).join('\n');
          return { text: `Sí, tenemos ${product_category}.\n${lines}\n\n¿Querés otra opción?`, session, rich: { image_url: top.image_url, caption } };
        }
        const line = `${top.name}${top.variant?` (${top.variant})`:''} a $${top.price} (stock ${top.qty_available}).`;
        return { text: `Sí, tenemos ${product_category}. Por ejemplo: ${line}`, session };
      }

      // No hay stock en la categoría → mostrar precio de algo sin stock si existe
      const outOfStockInCat = all.filter(p => (p.categories || '').includes(product_category));
      if (outOfStockInCat.length) {
        const p = outOfStockInCat[0];
        const msg = `${p.name}${p.variant?` (${p.variant})`:''} está a $${p.price}, pero ahora sin stock. ¿Te sugiero algo similar o te aviso cuando repongamos?`;
        if (mode === 'rich' && p.image_url) {
          return { text: msg, session, rich: { image_url: p.image_url, caption: `${p.name}${p.variant?` (${p.variant})`:''} — $${p.price} | sin stock` } };
        }
        return { text: msg, session };
      }

      return { text: `No encontré productos en la categoría ${product_category}. ¿Querés buscar por nombre?`, session };
    }

    // Sin categoría explícita: usa la mejor coincidencia
    if (list.length) {
      const top = list[0];
      const sufStock = top.qty_available>0 ? ` | Stock: ${top.qty_available}` : ' | ahora sin stock';
      if (mode === 'rich' && top.image_url) {
        return {
          text: `${top.name}${top.variant?` (${top.variant})`:''} — $${top.price}${sufStock}. ¿Querés más opciones?`,
          session,
          rich: { image_url: top.image_url, caption: `${top.name}${top.variant?` (${top.variant})`:''} — $${top.price}${sufStock}` }
        };
      }
      return { text: `${top.name}${top.variant?` (${top.variant})`:''} — $${top.price}${sufStock}. ¿Querés más opciones?`, session };
    }

    return { text: "No encontré ese producto. ¿Querés que busque por otra palabra o te sugiera alternativas?", session };
  }

  if (intent === 'reserva' && role !== 'ventas') {
    // reservas
    // Pedir datos si faltan
    if (!/(\d{4}-\d{2}-\d{2}).*(\d{2}:\d{2}).*(\d+)/.test(text)) {
      return { text: "Confirmame fecha (YYYY-MM-DD), hora (HH:mm) y cuántas personas, y lo reviso.", session };
    }
    // Nota: podrías parsear y llamar a check_availability/create_reservation automáticamente.
    return { text: "Perfecto. Pasame fecha (YYYY-MM-DD), hora (HH:mm) y cantidad de personas para verificar disponibilidad.", session };
  }

  // fallback elegante según rol
  if (role === 'ventas') {
    return { text: "¿Sobre qué producto te ayudo? Podés pedir por categoría (ej.: empanizados) o por nombre (ej.: milanesa).", session };
  }
  if (role === 'reservas') {
    return { text: "¿Para qué fecha y hora querés reservar y para cuántas personas? Reviso disponibilidad.", session };
  }
  return { text: "¿Sobre qué producto o reserva te ayudo? Podés pedir por categoría (ej.: empanizados) o por nombre (ej.: milanesa).", session };
}

module.exports = { runAgent };
