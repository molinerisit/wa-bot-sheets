
import { Intent, Synonym } from '../sql/models/index.js';

export function normalizeText(t='') {
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}

export async function detectIntent(text) {
  const intents = await Intent.findAll();
  for(const it of intents){
    if((it.training_phrases || []).some(p => text.includes((p||'').toLowerCase()))) {
      return it.name;
    }
  }
  if (['hola','buenas','buen dia','hello'].some(k => text.includes(k))) return 'greeting';
  if (['horario','abren','cierran'].some(k => text.includes(k))) return 'hours';
  if (['comprar','agrega','carrito','llevo','precio','tenes','tienes','buscar','busco'].some(k => text.includes(k))) return 'search_product';
  return 'unknown';
}

export async function replaceSynonyms(q) {
  const syns = await Synonym.findAll();
  let out = q;
  for (const s of syns) {
    for (const v of (s.variants||[])) {
      const re = new RegExp(`\\b${escapeRegExp(v)}\\b`, 'gi');
      out = out.replace(re, s.canonical);
    }
  }
  return out;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
