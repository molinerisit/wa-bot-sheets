
import dayjs from 'dayjs';
import { z } from 'zod';
import OpenAI from 'openai';
import { BotConfig, Conversation, Message } from '../sql/models/index.js';
import { detectIntent, normalizeText } from './nlu.js';
import { applyRules, listProducts } from './shop.js';
import { renderTemplate } from './nlg.js';
import { searchRag } from '../rag/service.js';
import { sequelize } from '../sql/db.js';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const ExtractSchema = z.object({
  action: z.enum(['smalltalk','search_product','buy','hours','unknown','qa']).default('qa'),
  product_query: z.string().optional(),
  quantity: z.number().int().positive().optional()
});

function buildRagSystemPrompt(botName='Bot'){
  return [
    `Sos ${botName}. RESPONDÉ SOLO con información presente en los fragmentos proporcionados (RAG).`,
    `Si la respuesta no está en los fragmentos, decí: "No tengo esa información cargada aún." (no inventes).`,
    `Sé conciso. Idioma: español de Argentina.`
  ].join('\n');
}

export async function handleIncoming({ channel, user_id, text }) {
  const cfgRows = await BotConfig.findAll();
  const cfg = Object.fromEntries(cfgRows.map(r=>[r.key, r.value]));
  const maxTurns = Number(process.env.BOT_MAX_TURNS || 6);
  const botName = cfg.bot_name || 'Bot';

  let convo = await Conversation.findOne({ where: { channel, user_id }});
  if(!convo) convo = await Conversation.create({ channel, user_id, state: {} });

  await Message.create({ conversation_id: convo.id, role:'user', content: text });

  const turnCount = await Message.count({ where: { conversation_id: convo.id } });
  if (turnCount > maxTurns*2) {
    const oos = cfg.oos_template || 'No entendí. ¿Querés intentar de nuevo?';
    await Message.create({ conversation_id: convo.id, role:'assistant', content: oos });
    return oos;
  }

  const normalized = normalizeText(text);

  // 1) Intent + LLM extract (pero la política por defecto es QA sobre RAG)
  let intent = await detectIntent(normalized);
  let llmExtract = { action: intent || 'qa' };
  try {
    const sys = 'Sos un parser. Devolvé exclusivamente JSON con las keys: action, product_query, quantity. action en {smalltalk,search_product,buy,hours,unknown,qa}.';
    const user = 'Texto: """' + text + '"""';
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{role:'system', content:sys},{role:'user', content:user}],
      temperature: 0
    });
    const raw = resp.choices[0].message?.content || '{}';
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd+1));
    llmExtract = ExtractSchema.parse(parsed);
  } catch(e){ /* fallback */ }

  const action = llmExtract.action || 'qa';

  // 2) Si es smalltalk u hours, responder sin RAG
  if (action === 'smalltalk') {
    const out = renderTemplate(cfg.greeting_template || 'Hola, soy {{bot_name}}. ¿En qué ayudo?', { bot_name: botName, greeting: '¡Hola!' });
    await Message.create({ conversation_id: convo.id, role:'assistant', content: out });
    return out;
  }
  if (action === 'hours') {
    const msg = 'Nuestro horario: lun-vie 09:00–19:00, sáb 09:00–13:00 (GMT-3).';
    await Message.create({ conversation_id: convo.id, role:'assistant', content: msg });
    return msg;
  }

  // 3) RAG FIRST (QA estricto)
  const snippets = await searchRag(text, 6);
  const context = snippets.map((s,i)=>`[${i+1}] ${s.text}`).join('\n\n');
  const sysRag = buildRagSystemPrompt(botName);
  let ragAnswer = '';
  try{
    const comp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [
        { role:'system', content: sysRag },
        { role:'user', content: `Consulta: ${text}\n\nFragmentos (RAG):\n${context}` }
      ]
    });
    ragAnswer = comp.choices[0].message?.content?.trim() || '';
  }catch(e){ ragAnswer = ''; }

  if (ragAnswer && !/no tengo esa informaci/i.test(ragAnswer)) {
    await Message.create({ conversation_id: convo.id, role:'assistant', content: ragAnswer });
    return ragAnswer;
  }

  // 4) Accionamiento ecommerce/agenda (solo vía DB externa con SQL whitelisteado)
  if (action === 'search_product' || action === 'buy') {
    // Si definiste external_db_url + allowed_sql, usamos eso
    const externalUrl = cfg.external_db_url;
    const allow = safeParseJSON(cfg.external_allowed_sql) || [];
    if (externalUrl && allow.length){
      // Pequeño ejecutor de queries permitidos (solo SELECT) hacia una segunda conexión
      const { Sequelize } = await import('sequelize');
      const ext = new Sequelize(externalUrl, { dialect:'postgres', logging:false });
      // tomar primera consulta whitelisted como catálogo
      const sql = String(allow[0]||'').toLowerCase().startsWith('select') ? allow[0] : null;
      if(sql){
        const [rows] = await ext.query(sql);
        const match = (q) => rows.filter(r => JSON.stringify(r).toLowerCase().includes(q.toLowerCase())).slice(0,8);
        const found = match(text);
        if(found.length){
          const lines = found.map(r => '• ' + (r.name || r.titulo || r.descripcion || JSON.stringify(r)));
         const msg = 'Resultados:\n' + lines.join('\n');
          await Message.create({ conversation_id: convo.id, role:'assistant', content: msg });
          return msg;
        }
      }
      // fallback si no hay o no coincide
    } else {
      // Uso del catálogo simulado interno (shop.*) si no hay DB externa configurada
      const items = await listProducts(text);
      const adjusted = await applyRules(items, {});
      if (adjusted.length){
        const lines = adjusted.slice(0,8).map(p=>`• ${p.name} (${p.sku}) — $${p.price}${p._discount?` (-${p._discount}%)`:''}`);
        const msg = `Encontré ${adjusted.length} resultado(s):\n` + lines.join('\n');
        await Message.create({ conversation_id: convo.id, role:'assistant', content: msg });
        return msg;
      }
    }
  }

  // 5) Si RAG no alcanzó y no hay acción clara
  const fallback = cfg.oos_template || 'No tengo esa información cargada aún.';
  await Message.create({ conversation_id: convo.id, role:'assistant', content: fallback });
  return fallback;
}

function safeParseJSON(v){
  try{ return JSON.parse(v); }catch(_){ return null; }
}
