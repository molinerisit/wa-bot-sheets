const Mustache = require('mustache');
const { readBotConfig } = require('../sheets/config');
const { findProducts } = require('../sheets/stock');
const { sendText, sendMedia } = require('../evo');
const { logger } = require('../utils/logger');
const { getSession, saveSession } = require('../memory/store');
const { runAgent } = require('../nlu/agent');

// --------- utilidades ----------
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

function isGreeting(text = '') {
  const t = (text || '').toLowerCase().trim();
  return /^(hola|buenas|buen día|buen dia|buenas tardes|buenas noches|qué tal|que tal)\b/.test(t);
}
function isPhotoRequest(text = '') {
  const t = (text || '').toLowerCase();
  return /mostrame fotos|mandame fotos|mostrar fotos|ver fotos|con fotos|modo catálogo|modo catalogo|catálogo|catalogo/.test(t);
}
function isCatalogRequest(text = '') {
  const t = (text || '').toLowerCase();
  return /qué vendes|que vendes|catalogo|catálogo|ver productos|mostrame productos/.test(t);
}
function isFollowUpQuestion(t='') {
  const x = (t || '').toLowerCase().trim();
  return /^(que cosa|qué cosa|cual|cuál|como es|cómo es|y cual|y cuál|cuales|cuáles)\b/.test(x);
}

// --------- extractores Evolution ----------
function unwrap(ev) { return ev && ev.data ? ev.data : ev; }

function extractFromNumber(ev) {
  const e = unwrap(ev);
  const jid = e?.key?.remoteJid || e?.from || e?.number || '';
  if (typeof jid === 'string' && jid.includes('@')) return jid.split('@')[0];
  return typeof jid === 'string' ? jid : '';
}
function getMessageId(ev) {
  const e = unwrap(ev);
  return e?.key?.id || e?.data?.key?.id || e?.messageId || null;
}
function getRemoteJid(ev) {
  const e = unwrap(ev);
  return e?.key?.remoteJid || e?.from || e?.number || '';
}
function extractTextFromEvolution(ev) {
  const e = unwrap(ev);
  const m = e?.message;
  if (typeof e?.text === 'string') return e.text;
  if (typeof m === 'string') return m;
  if (m?.conversation) return m.conversation;
  if (m?.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m?.imageMessage?.caption) return m.imageMessage.caption;
  if (m?.videoMessage?.caption) return m.videoMessage.caption;
  if (m?.documentMessage?.caption) return m.documentMessage.caption;
  if (e?.message?.text?.body) return e.message.text.body;
  return '';
}

// --------- selección de “mejor” producto ----------
function pickBestProduct(list=[]) {
  const withStock = list.filter(p => (p.qty_available || 0) > 0);
  if (withStock.length) {
    return withStock.sort((a,b)=> (a.price||0)-(b.price||0))[0];
  }
  return list[0];
}

// --------- helper: intentar responder desde stock directo ----------
async function tryDirectStock(text, from, cfg, session, viewModeOverride) {
  const items = await findProducts(text); // normalizador + fuzzy + IA fallback
  if (items && items.length) {
    const p = pickBestProduct(items);
    const line = `${p.name}${p.variant ? ` (${p.variant})` : ''} — $${p.price} | Stock: ${p.qty_available}`;
    session.last_product = p.name;
    await saveSession(from, session);
    const mode = (viewModeOverride || cfg.response_mode || 'concise').toLowerCase();
    if (p.image_url && mode === 'rich') {
      await sendMedia(from, p.image_url, line);
    } else {
      await sendText(from, line);
    }
    return true;
  }
  return false;
}

// --------- handler ----------
async function handleIncoming(ev) {
  try {
    const msgId = getMessageId(ev);
    const from = extractFromNumber(ev) || getRemoteJid(ev);
    const text = extractTextFromEvolution(ev);
    if (!from) { logger.warn({ ev }, 'Mensaje sin remitente (from)'); return; }

    const cfg = await readBotConfig();
    const session = await getSession(from);

    // --- DEDUPE por message id ---
    if (msgId) {
      if (session.last_msg_id === msgId) {
        logger.info({ from, msgId }, 'Duplicado ignorado');
        return;
      }
      session.last_msg_id = msgId;
      await saveSession(from, session);
    }

    let greeted = false;

    // 0) Saludos — SOLO si es saludo puro corto; si es “hola + algo”, saludo y SIGO
    const onlyGreeting = /^[\s]*(hola|buenas|buen día|buen dia|buenas tardes|buenas noches|qué tal|que tal)[\s]*$/i.test(text || '');
    if (onlyGreeting) {
      const msg = Mustache.render(cfg.greeting_template || 'Hola', { bot_name: cfg.bot_name || 'Bot' });
      await sendText(from, msg);
      await saveSession(from, { ...session, history: (session.history || []).concat([{ role:'user', content:text }, { role:'assistant', content:msg }]) });
      return;
    }
    if (isGreeting(text)) {
      const msg = Mustache.render(cfg.greeting_template || 'Hola', { bot_name: cfg.bot_name || 'Bot' });
      await sendText(from, msg);
      greeted = true;
      await saveSession(from, { ...session, history: (session.history || []).concat([{ role:'user', content:text }, { role:'assistant', content:msg }]) });
      // NO cortar
    }

    // 1) Overrides de visualización (one-shot)
    const viewModeOverride = (isPhotoRequest(text) || isCatalogRequest(text)) ? 'rich' : null;

    // 2) Agente (OpenAI + tools)
    const userCtx = {
      tz: cfg.timezone || 'America/Argentina/Cordoba',
      last_product: session.last_product || null
    };
    const agentOut = await runAgent({ userCtx, session, text, viewMode: viewModeOverride });

    if (agentOut && agentOut.text) {
      // Si devuelve "genérico", no cortamos: dejamos que siga al plan B
      const generic = /producto.*reserva.*ayudo/i.test(agentOut.text.toLowerCase());
      const mode = (viewModeOverride || cfg.response_mode || 'concise').toLowerCase();

      if (!generic) {
        await sendText(from, agentOut.text);
        if (mode === 'rich' && agentOut.rich?.image_url) {
          await sendMedia(from, agentOut.rich.image_url, agentOut.rich.caption || '');
        }
        const newHistory = (session.history || []).concat(
          [{ role: 'user', content: text }, { role: 'assistant', content: agentOut.text }]
        );
        const merged = { ...(agentOut.session || session), history: newHistory };
        await saveSession(from, merged);
        return; // corto si NO es genérico
      }
      logger.info({ text }, 'Respuesta genérica detectada, usando plan B');
    }

    // --- FOLLOW-UP con contexto (“¿qué cosa?” etc.) ---
    if (isFollowUpQuestion(text)) {
      const lp = session.last_product;
      if (lp) {
        const items = await findProducts(lp);
        if (items && items.length) {
          const best = pickBestProduct(items);
          // alternativos: misma categoría si es posible
          let alt = [];
          try {
            alt = (await findProducts('empanizado'))
              .filter(x => x.name !== best.name && (x.qty_available || 0) > 0)
              .slice(0, 2);
          } catch {}
          const altLine = alt.length ? ` También tengo: ${alt.map(a => `${a.name} $${a.price}`).join(', ')}.` : '';
          const mainLine = `${best.name}${best.variant ? ` (${best.variant})` : ''} — $${best.price}${best.qty_available>0?` | Stock: ${best.qty_available}`:' | ahora sin stock'}.`;
          await sendText(from, mainLine + altLine);
          return;
        }
      }
      await sendText(from, "¿De qué producto hablás? Ej.: milanesa, empanizado, bife, vacío.");
      return;
    }

    // 3) Modo básico (keywords)
    const qNorm = normalizeQuery(text, cfg.synonyms);
    const intent = detectIntent(qNorm, cfg.intents);

    if (intent === 'consulta_stock') {
      const items = await findProducts(qNorm);
      if (items && items.length) {
        const p = pickBestProduct(items);
        const line = `${p.name}${p.variant ? ` (${p.variant})` : ''} — $${p.price} | Stock: ${p.qty_available}`;
        session.last_product = p.name;
        await saveSession(from, session);
        const mode = (viewModeOverride || cfg.response_mode || 'concise').toLowerCase();
        if (p.image_url && mode === 'rich') await sendMedia(from, p.image_url, line);
        else await sendText(from, line);
        return;
      }
      await sendText(from, "¿Sobre qué producto o categoría querés consultar? (ej.: empanizado, bife, vacío, milanesa)");
      return;
    }

    // 4) Refuerzo final: búsqueda directa con el texto crudo
    if (await tryDirectStock(text, from, cfg, session, viewModeOverride)) return;

    // 5) Default (si ya saludé en este mismo mensaje, no vuelvo a saludar)
    if (!greeted) {
      const msg = Mustache.render(cfg.greeting_template || 'Hola', { bot_name: cfg.bot_name || 'Bot' });
      await sendText(from, msg);
    } else {
      await sendText(from, "Decime el producto o categoría (ej.: empanizado, bife, vacío, milanesa).");
    }
  } catch (err) {
    logger.error({ err, ev }, 'engine.handleIncoming error');
  }
}

module.exports = { handleIncoming };
