/**
 * engine.js
 * Orquestador principal: recibe el webhook, deduplica eventos,
 * saluda si corresponde, llama al agente NLU (OpenAI) y/o
 * cae al plan B de keywords + búsqueda en stock.
 *
 * Cambios clave:
 * - Dedupe por messageId (evita dobles respuestas/saludos).
 * - Saludo "puro" corta; "hola + pedido" saluda y sigue.
 * - Respuestas de producto SIN "Stock: N" por defecto (solo precio).
 * - Prioriza "Milanesa especial" si la consulta es "milanesa(s)" (aunque no haya stock).
 * - Si no hay stock, sugiere alternativas con stock.
 * - Follow-up con contexto ("¿qué cosa?") usando session.last_product.
 * - Si el agente devuelve respuesta genérica, NO cortamos (se usa plan B).
 */

const Mustache = require('mustache');
const { readBotConfig } = require('../sheets/config');
const { findProducts } = require('../sheets/stock');
const { sendText, sendMedia } = require('../evo');
const { logger } = require('../utils/logger');
const { getSession, saveSession } = require('../memory/store');
const { runAgent } = require('../nlu/agent');

// ===================== Utils de NLU local (plan B) =====================

function normalizeQuery(q, synonyms = {}) {
  // Reemplaza sinónimos por su forma canónica (ej. "milaneas" -> "milanesa")
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
  // Intent matcher muy simple basado en "includes"
  const t = (typeof q === 'string' ? q : '').toLowerCase();
  for (const it of intents || []) {
    for (const ex of (it.examples || [])) {
      if (t.includes(String(ex).toLowerCase())) return it.name;
    }
  }
  return 'fallback';
}

function isGreeting(text = '') {
  const t = text.toLowerCase().trim();
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

function isFollowUpQuestion(t = '') {
  // Follow-ups cortos sin contexto explícito
  const x = (t || '').toLowerCase().trim();
  return /^(que cosa|qué cosa|cual|cuál|como es|cómo es|y cual|y cuál|cuales|cuáles)\b/.test(x);
}

// ===================== Extractores Evolution (robustos) =====================

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
  // Toma texto desde todas las variantes posibles de Evolution
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

// ===================== Formateo y selección de producto =====================

/**
 * Devuelve la línea de producto para enviar al usuario.
 * Por defecto: SOLO precio (sin "Stock: N"). Si no hay stock, lo marca entre paréntesis.
 */
function productLine(p, cfg, { includeStock = false, markOOS = true } = {}) {
  const base = `${p.name}${p.variant ? ` (${p.variant})` : ''} — $${p.price}`;
  if (!includeStock) {
    if (markOOS && (p.qty_available || 0) <= 0) return base + ' (ahora sin stock)';
    return base;
  }
  const stock = ` | Stock: ${p.qty_available}`;
  if (markOOS && (p.qty_available || 0) <= 0) return base + ' | ahora sin stock';
  return base + stock;
}

/**
 * pickBestProduct:
 * - Si la query menciona "milanesa(s)", prioriza "Milanesa especial" (aunque esté sin stock).
 * - Si no, prioriza con stock y luego menor precio.
 */
function pickBestProduct(list = [], { query = '' } = {}) {
  if (!list.length) return null;
  const q = (query || '').toLowerCase();

  const norm = s => (s || '').toLowerCase();
  const byName = (name, word) => norm(name).includes(norm(word));

  // Regla específica: milanesa(s) => preferir "especial"
  if (/\bmilanesa(s)?\b/i.test(q)) {
    const milas = list.filter(p => byName(p.name, 'milanesa'));
    if (milas.length) {
      const especial = milas.find(p => byName(p.name, 'especial'));
      if (especial) return especial;
      return milas[0];
    }
  }

  // General: primero con stock (precio más bajo)
  const withStock = list.filter(p => (p.qty_available || 0) > 0);
  if (withStock.length) {
    return withStock.sort((a, b) => (a.price || 0) - (b.price || 0))[0];
  }
  return list[0];
}

// ===================== Helper: búsqueda directa en stock =====================

async function tryDirectStock(text, from, cfg, session, viewModeOverride) {
  // findProducts ya incluye normalizador + fuzzy + IA fallback
  const items = await findProducts(text);
  if (items && items.length) {
    const p = pickBestProduct(items, { query: text });
    const line = productLine(p, cfg, { includeStock: false }); // <<< sin "Stock: N"
    session.last_product = p.name;
    await saveSession(from, session);

    const mode = (viewModeOverride || cfg.response_mode || 'concise').toLowerCase();
    if (p.image_url && mode === 'rich') {
      await sendMedia(from, p.image_url, line);
    } else {
      await sendText(from, line);
    }

    // Si no hay stock, ofrecer alternativas (misma familia si aplica)
    if ((p.qty_available || 0) <= 0) {
      try {
        const alt = (await findProducts('empanizado'))
          .filter(x => x.name !== p.name && (x.qty_available || 0) > 0)
          .slice(0, 2);
        if (alt.length) {
          const altLine = alt
            .map(a => productLine(a, cfg, { includeStock: false, markOOS: false }))
            .join(' | ');
          await sendText(from, `También tengo: ${altLine}.`);
        }
      } catch (e) {
        logger.warn({ e }, 'Alternatives suggestion failed');
      }
    }
    return true;
  }
  return false;
}

// ===================== Handler principal =====================

async function handleIncoming(ev) {
  try {
    // Identificación y extracción robusta
    const msgId = getMessageId(ev);
    const from = extractFromNumber(ev) || getRemoteJid(ev);
    const text = extractTextFromEvolution(ev);
    if (!from) { logger.warn({ ev }, 'Mensaje sin remitente (from)'); return; }

    const cfg = await readBotConfig();
    const session = await getSession(from);

    // --- 0) DEDUPE por message id ---
    if (msgId) {
      if (session.last_msg_id === msgId) {
        logger.info({ from, msgId }, 'Duplicado ignorado');
        return;
      }
      session.last_msg_id = msgId;
      await saveSession(from, session);
    }

    let greeted = false;

    // --- 1) Saludo "puro" corta; "hola + algo" saluda y sigue ---
    const onlyGreeting = /^[\s]*(hola|buenas|buen día|buen dia|buenas tardes|buenas noches|qué tal|que tal)[\s]*$/i.test(text || '');
    if (onlyGreeting) {
      const msg = Mustache.render(cfg.greeting_template || 'Hola', { bot_name: cfg.bot_name || 'Bot' });
      await sendText(from, msg);
      await saveSession(from, {
        ...session,
        history: (session.history || []).concat([{ role: 'user', content: text }, { role: 'assistant', content: msg }])
      });
      return;
    }
    if (isGreeting(text)) {
      const msg = Mustache.render(cfg.greeting_template || 'Hola', { bot_name: cfg.bot_name || 'Bot' });
      await sendText(from, msg);
      greeted = true; // marcamos que ya saludamos en ESTE turno
      await saveSession(from, {
        ...session,
        history: (session.history || []).concat([{ role: 'user', content: text }, { role: 'assistant', content: msg }])
      });
      // NO cortamos: dejamos seguir a NLU/keywords
    }

    // --- 2) Overrides de visualización: si piden catálogo/fotos, forzamos 'rich' ---
    const viewModeOverride = (isPhotoRequest(text) || isCatalogRequest(text)) ? 'rich' : null;

    // --- 3) Agente (OpenAI + tools) ---
    const userCtx = {
      tz: cfg.timezone || 'America/Argentina/Cordoba',
      last_product: session.last_product || null
    };
    const agentOut = await runAgent({ userCtx, session, text, viewMode: viewModeOverride });

    if (agentOut && agentOut.text) {
      // Si el agente responde "genérico", NO cortamos: usamos plan B
      const generic = /producto.*reserva.*ayudo/i.test(agentOut.text.toLowerCase());
      const mode = (viewModeOverride || cfg.response_mode || 'concise').toLowerCase();

      if (!generic) {
        await sendText(from, agentOut.text);
        if (mode === 'rich' && agentOut.rich?.image_url) {
          await sendMedia(from, agentOut.rich.image_url, agentOut.rich.caption || '');
        }
        const newHistory = (session.history || []).concat([
          { role: 'user', content: text },
          { role: 'assistant', content: agentOut.text }
        ]);
        const merged = { ...(agentOut.session || session), history: newHistory };
        await saveSession(from, merged);
        return; // solo cortamos si NO es genérico
      }
      logger.info({ text }, 'Respuesta genérica detectada por agente; se usa plan B');
    }

    // --- 4) Follow-up con contexto ("¿qué cosa?") ---
    if (isFollowUpQuestion(text)) {
      const lp = session.last_product;
      if (lp) {
        const items = await findProducts(lp);
        if (items && items.length) {
          const best = pickBestProduct(items, { query: lp });
          let msg = productLine(best, cfg, { includeStock: false });
          if ((best.qty_available || 0) <= 0) {
            const alt = (await findProducts('empanizado'))
              .filter(x => x.name !== best.name && (x.qty_available || 0) > 0)
              .slice(0, 2);
            if (alt.length) {
              msg += ` | Alternativas: ${alt
                .map(a => productLine(a, cfg, { includeStock: false, markOOS: false }))
                .join(' | ')}`;
            }
          }
          await sendText(from, msg);
          return;
        }
      }
      await sendText(from, "¿De qué producto hablás? Ej.: milanesa, empanizado, bife, vacío.");
      return;
    }

    // --- 5) Plan B (keywords/config) ---
    const qNorm = normalizeQuery(text, cfg.synonyms);
    const intent = detectIntent(qNorm, cfg.intents);

    if (intent === 'consulta_stock') {
      const items = await findProducts(qNorm);
      if (items && items.length) {
        const p = pickBestProduct(items, { query: qNorm });
        const line = productLine(p, cfg, { includeStock: false }); // <<< sin "Stock: N"
        session.last_product = p.name;
        await saveSession(from, session);
        const mode = (viewModeOverride || cfg.response_mode || 'concise').toLowerCase();
        if (p.image_url && mode === 'rich') await sendMedia(from, p.image_url, line);
        else await sendText(from, line);

        // Sugerir alternativas si el elegido está sin stock
        if ((p.qty_available || 0) <= 0) {
          try {
            const alt = (await findProducts('empanizado'))
              .filter(x => x.name !== p.name && (x.qty_available || 0) > 0)
              .slice(0, 2);
            if (alt.length) {
              const altLine = alt
                .map(a => productLine(a, cfg, { includeStock: false, markOOS: false }))
                .join(' | ');
              await sendText(from, `También tengo: ${altLine}.`);
            }
          } catch (e) {
            logger.warn({ e }, 'Alternatives suggestion failed (plan B)');
          }
        }
        return;
      }
      // No se encontró nada por keywords → pedimos precisión
      await sendText(from, "¿Sobre qué producto o categoría querés consultar? (ej.: empanizado, bife, vacío, milanesa)");
      return;
    }

    // --- 6) Refuerzo final: búsqueda directa con el texto crudo ---
    if (await tryDirectStock(text, from, cfg, session, viewModeOverride)) return;

    // --- 7) Default: si ya saludamos en este turno, no re-saludar ---
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
