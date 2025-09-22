const Mustache = require('mustache');
const { readBotConfig } = require('../sheets/config');
const { findProducts } = require('../sheets/stock');
const { sendText, sendMedia } = require('../evo');
const { logger } = require('../utils/logger');

// --------- utilidades NLU / normalización ----------
function normalizeQuery(q, synonyms = {}) {
  const raw = (typeof q === 'string' ? q : '').toLowerCase();
  let out = raw;
  for (const [canon, syns] of Object.entries(synonyms || {})) {
    for (const s of syns || []) {
      const from = String(s).toLowerCase();
      const to = String(canon).toLowerCase();
      if (from) out = out.replaceAll(from, to);
    }
  }
  return out;
}

function detectIntent(q, intents = []) {
  const t = (typeof q === 'string' ? q : '').toLowerCase();
  for (const it of intents || []) {
    for (const ex of (it.examples || [])) {
      if (t.includes(String(ex).toLowerCase())) return it.name;
    }
  }
  return 'fallback';
}

// --------- extractores robustos para Evolution ---------
function unwrap(ev) {
  // Evolution suele mandar { event, instance, data: {...} }
  return ev && ev.data ? ev.data : ev;
}

function extractFromNumber(ev) {
  const e = unwrap(ev);
  const jid = e?.key?.remoteJid || e?.from || e?.number || '';
  if (typeof jid === 'string' && jid.includes('@')) return jid.split('@')[0];
  return typeof jid === 'string' ? jid : '';
}

function extractTextFromEvolution(ev) {
  const e = unwrap(ev);
  const m = e?.message;

  // 1) String directo
  if (typeof e?.text === 'string') return e.text;
  if (typeof m === 'string') return m;

  // 2) Estructuras típicas WhatsApp
  if (m?.conversation) return m.conversation;
  if (m?.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m?.imageMessage?.caption) return m.imageMessage.caption;
  if (m?.videoMessage?.caption) return m.videoMessage.caption;
  if (m?.documentMessage?.caption) return m.documentMessage.caption;

  // 3) Otros formatos vistos (message.text.body)
  if (e?.message?.text?.body) return e.message.text.body;

  // 4) Fallback
  return '';
}

// --------- manejador principal ----------
async function handleIncoming(ev) {
  try {
    const from = extractFromNumber(ev);
    const text = extractTextFromEvolution(ev);

    if (!from) {
      logger.warn({ ev }, 'Mensaje sin remitente (from)');
      return;
    }

    const cfg = await readBotConfig();
    const qNorm = normalizeQuery(text, cfg.synonyms);
    const intent = detectIntent(qNorm, cfg.intents);

    if (intent === 'consulta_stock') {
      const items = await findProducts(qNorm);
      if (items && items.length) {
        const p = items[0];
        const line = `${p.name}${p.variant ? ` (${p.variant})` : ''} — $${p.price} | Stock: ${p.qty_available}`;
        if (p.image_url) {
          await sendMedia(from, p.image_url, line);
        } else {
          await sendText(from, line);
        }
        return;
      }
      const msg = (cfg.oos_template || 'No lo tengo ahora.').replace('{{product}}', qNorm || '');
      await sendText(from, msg);
      return;
    }

    // Fallback / saludo
    const msg = Mustache.render(cfg.greeting_template || 'Hola', { bot_name: cfg.bot_name || 'Bot' });
    await sendText(from, msg);
  } catch (err) {
    logger.error({ err, ev }, 'engine.handleIncoming error');
  }
}

module.exports = { handleIncoming };
