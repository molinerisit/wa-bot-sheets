const OpenAI = require('openai');
const { logger } = require('../utils/logger');
const { findProducts, readStock } = require('../sheets/stock');
const { checkAvailability } = require('../sheets/availability');
const { createReservation } = require('../sheets/reservations');
const { readBotConfig } = require('../sheets/config');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const tools = [
  {
    type: "function",
    function: {
      name: "search_products",
      description: "Buscar productos por texto libre y devolver una lista corta con sku, name, variant, price, qty_available, image_url.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
    }
  },
  {
    type: "function",
    function: {
      name: "get_product_details",
      description: "Obtener detalles de un producto por sku exacto.",
      parameters: { type: "object", properties: { sku: { type: "string" } }, required: ["sku"] }
    }
  },
  {
    type: "function",
    function: {
      name: "check_availability",
      description: "Chequear disponibilidad en agenda para una fecha/hora y cantidad de personas.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          time: { type: "string", description: "HH:mm" },
          people: { type: "number" }
        },
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
        properties: {
          name: { type: "string" },
          phone: { type: "string" },
          date: { type: "string" },
          time: { type: "string" },
          people: { type: "number" },
          notes: { type: "string" }
        },
        required: ["date","time","people"]
      }
    }
  }
];

async function toolRouter(name, args, context) {
  switch (name) {
    case 'search_products': {
      const rows = await findProducts(args.query || '');
      const trimmed = rows.slice(0, 5).map(p => ({
        sku: p.sku, name: p.name, variant: p.variant, price: p.price,
        qty_available: p.qty_available, image_url: p.image_url || ''
      }));
      // memorizar último producto si hay un match claro
      if (trimmed[0]) context.session.last_product = trimmed[0].name;
      return { ok: true, results: trimmed };
    }
    case 'get_product_details': {
      const all = await readStock();
      const p = all.find(x => x.sku === args.sku);
      if (p) context.session.last_product = p.name;
      return { ok: !!p, product: p || null };
    }
    case 'check_availability': {
      const out = await checkAvailability(args.date, args.time, args.people);
      return { ok: true, ...out };
    }
    case 'create_reservation': {
      const { name, phone, date, time, people, notes } = args;
      const out = await createReservation({ name, phone, date, time, people, notes });
      context.session.reservation = { id: out.id, name, phone, date, time, people, notes, status: out.status };
      return { ok: true, reservation: context.session.reservation };
    }
    default:
      return { ok: false, error: 'unknown_tool' };
  }
}

function businessPolicyText(cfg) {
  // Usamos reglas de negocio desde config para guiar al modelo
  const hours = typeof cfg.business_hours === 'object' ? JSON.stringify(cfg.business_hours) : String(cfg.business_hours || '');
  const policy = [
    `Horario: ${hours || 'no especificado'}.`,
    `Idioma: ${cfg.language || 'es-AR'}.`,
    `Zona horaria: ${cfg.timezone || 'America/Argentina/Cordoba'}.`,
    `No realizar ventas/checkout: redirigir a e-commerce si piden comprar (${cfg.ecommerce_url || 'sin URL configurada'}).`,
    `Si usuario pregunta "¿tenés stock?" sin producto → pedir el producto.`,
    `Nunca inventes stock ni precios: consultá herramientas.`,
  ].join(' ');
  return policy;
}

async function runAgent({ userCtx, session, text }) {
  if (!process.env.OPENAI_API_KEY) return null;

  const cfg = await readBotConfig();
  const system = [
    "Eres un asistente en español rioplatense: claro, amable, preciso.",
    "Rol: asesor/secretario. Respondes sobre productos (precio/stock/detalles) y agenda (disponibilidad/reservas).",
    "NO vendes ni cobrás. Si piden comprar, indicá que las ventas se realizan por el e-commerce configurado.",
    "Pedí aclaraciones cuando falten datos (producto, fecha/hora, personas).",
    "Usá las herramientas para verificar datos reales.",
    businessPolicyText(cfg)
  ].join(' ');

  const messages = [
    { role: "system", content: system },
    ...(session.history || []).slice(-8),
    { role: "user", content: text }
  ];

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const context = { session };

  let res = await client.chat.completions.create({
    model: MODEL,
    messages,
    tools,
    tool_choice: "auto",
    temperature: 0.3,
    max_tokens: 350
  });

  for (let i = 0; i < 2; i++) {
    const choice = res.choices?.[0];
    const msg = choice?.message;
    if (!msg) break;

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const call = msg.tool_calls[0];
      const name = call.function.name;
      const args = JSON.parse(call.function.arguments || "{}");

      const toolResult = await toolRouter(name, args, context);

      messages.push({ role: "assistant", tool_calls: [call], content: "" });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(toolResult) });

      res = await client.chat.completions.create({
        model: MODEL,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.3,
        max_tokens: 350
      });
    } else {
      break;
    }
  }

  const final = res.choices?.[0]?.message?.content || "";
  return { text: final, session: context.session };
}

module.exports = { runAgent };
