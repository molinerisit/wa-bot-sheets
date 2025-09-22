const Mustache = require('mustache');
const { readBotConfig } = require('../sheets/config');
const { findProducts } = require('../sheets/stock');
const { sendText, sendMedia } = require('../evo');
const { logger } = require('../utils/logger');

function normalizeQuery(q, synonyms = {}) {
  let out = (q || '').toLowerCase();
  for (const [canon, syns] of Object.entries(synonyms)) {
    for (const s of syns) out = out.replaceAll(String(s).toLowerCase(), String(canon).toLowerCase());
  }
  return out;
}

function detectIntent(q, intents = []) {
  const t = (q || '').toLowerCase();
  for (const it of intents) {
    for (const ex of (it.examples || [])) {
      if (t.includes(String(ex).toLowerCase())) return it.name;
    }
  }
  return 'fallback';
}

function extractTextFromEvolution(body) {
  // Evolution API puede enviar distintos formatos; intentamos mapear los más comunes
  // Soporta: body.message.text, body.message, body.text, body.payload?.body, etc.
  return (
    body?.message?.text ||
    body?.message ||
    body?.text ||
    body?.payload?.body ||
    body?.Body ||
    ''
  );
}

function extractFromNumber(body) {
  // Intentos comunes: body.from, body.number, body.key.remoteJid (formato '549341...@s.whatsapp.net')
  const jid = body?.key?.remoteJid || '';
  if (jid && jid.includes('@')) return jid.split('@')[0];
  return body?.from || body?.number || '';
}

async function handleIncoming(body) {
  const from = extractFromNumber(body);
  const text = extractTextFromEvolution(body);
  if (!from) {
    logger.warn({ body }, 'Mensaje sin remitente (from)');
    return;
  }

  const cfg = await readBotConfig();
  const qNorm = normalizeQuery(text, cfg.synonyms);
  const intent = detectIntent(qNorm, cfg.intents);

  if (intent === 'consulta_stock') {
    const items = await findProducts(qNorm);
    if (items.length) {
      const p = items[0];
      const line = `${p.name}${p.variant ? ` (${p.variant})` : ''} — $${p.price} | Stock: ${p.qty_available}`;
      if (p.image_url) {
        await sendMedia(from, p.image_url, line);
      } else {
        await sendText(from, line);
      }
      return;
    }
    const msg = cfg.oos_template.replace('{{product}}', qNorm);
    await sendText(from, msg);
    return;
  }

  const msg = Mustache.render(cfg.greeting_template, { bot_name: cfg.bot_name });
  await sendText(from, msg);
}

module.exports = { handleIncoming };
