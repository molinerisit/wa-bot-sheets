const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { logger } = require('../utils/logger');
const { readBotConfig } = require('./config');
const { getSheets } = require('./sheets'); // helper existente para Google Sheets

// rutas posibles a CSV
function candidateCsvPaths() {
  return [
    path.join(process.cwd(), 'stock.csv'),
    path.join(__dirname, '..', '..', 'stock.csv'),
    path.join(__dirname, '..', 'stock.csv')
  ];
}

function normalize(t='') {
  return (t || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(tenes|tienes|quiero|quisiera|hay|mostrame|muestrame|mostra|decime|necesito|me|para|la|el|de|unas|unos|un|una)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/s\b/, ''); // plural simple → singular
}

// Levenshtein simple
function lev(a='', b='') {
  a = a || ''; b = b || '';
  const m = a.length, n = b.length;
  const dp = Array.from({length: m+1}, () => Array(n+1).fill(0));
  for (let i=0;i<=m;i++) dp[i][0]=i;
  for (let j=0;j<=n;j++) dp[0][j]=j;
  for (let i=1;i<=m;i++) {
    for (let j=1;j<=n;j++) {
      const cost = a[i-1]===b[j-1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
    }
  }
  return dp[m][n];
}
function fuzzyHit(q, text) {
  const tokens = (text || '').split(/[^a-z0-9áéíóúüñ]+/i).filter(Boolean).map(x=>normalize(x));
  const qn = normalize(q);
  if (!qn) return false;
  if (tokens.some(t => t.includes(qn) || qn.includes(t))) return true;
  return tokens.some(t => lev(t, qn) <= 2);
}

// ---------- Lectores ----------
async function readStockFromSheets() {
  if (!process.env.SPREADSHEET_ID) throw new Error('No SPREADSHEET_ID');
  const s = getSheets();
  const res = await s.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'stock!A1:Z999'
  });
  const rows = res.data.values || [];
  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h || '').trim());
  const idx = k => headers.indexOf(k);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const get = (k) => r[idx(k)] ?? '';
    out.push({
      sku: get('sku'),
      name: get('name'),
      variant: get('variant') || '',
      price: Number(get('price')) || 0,
      qty_available: Number(get('qty_available')) || 0,
      categories: String(get('categories') || ''),
      image_url: get('image_url') || ''
    });
  }
  return out;
}

function readStockFromCsvSync() {
  for (const p of candidateCsvPaths()) {
    try {
      if (!fs.existsSync(p)) continue;
      const text = fs.readFileSync(p, 'utf8');
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (!lines.length) continue;
      const headers = lines[0].split(',').map(x => x.trim());
      const idx = k => headers.indexOf(k);
      const out = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const get = (k) => (idx(k) >= 0 ? (cols[idx(k)] || '').trim() : '');
        out.push({
          sku: get('sku'),
          name: get('name'),
          variant: get('variant') || '',
          price: Number(get('price')) || 0,
          qty_available: Number(get('qty_available')) || 0,
          categories: get('categories') || '',
          image_url: get('image_url') || ''
        });
      }
      logger.info({ path: p, count: out.length }, 'Leído stock desde CSV');
      return out;
    } catch (e) {
      logger.warn({ path: p, e }, 'Error leyendo CSV, probando otra ruta');
    }
  }
  return [];
}

async function readStock() {
  try {
    const rows = await readStockFromSheets();
    if (rows.length) {
      logger.info({ source: 'sheets', count: rows.length }, 'Stock OK');
      return rows;
    }
  } catch (e) {
    logger.warn({ e }, 'Falla leyendo Sheets, intento CSV');
  }
  try {
    const rows = readStockFromCsvSync();
    if (rows.length) {
      logger.info({ source: 'csv', count: rows.length }, 'Stock OK');
      return rows;
    }
  } catch (e) {
    logger.warn({ e }, 'Falla leyendo CSV');
  }
  logger.warn('Stock vacío (ni Sheets ni CSV).');
  return [];
}

function prioritize(list=[]) {
  return [...list].sort((a, b) => {
    const sa = (a.qty_available || 0) > 0 ? 0 : 1;
    const sb = (b.qty_available || 0) > 0 ? 0 : 1;
    if (sa !== sb) return sa - sb;       // primero con stock
    return (a.price || 0) - (b.price || 0); // luego por precio asc
  });
}

// ---------- Buscador ----------
async function findProducts(query, category) {
  const qNorm = normalize(query);
  const catNorm = normalize(category || '');
  const stock = await readStock();

  // 1) Literal
  let results = stock.filter(p => {
    const name = normalize(p.name || '');
    const variant = normalize(p.variant || '');
    const cats = normalize(p.categories || '');
    const nameHit = qNorm && (name.includes(qNorm) || variant.includes(qNorm));
    const catHit = catNorm && cats.includes(catNorm);
    return nameHit || catHit;
  });
  if (results.length) return prioritize(results);

  // 2) Fuzzy (para typos tipo "milaneas")
  results = stock.filter(p => {
    const name = normalize(p.name || '');
    const variant = normalize(p.variant || '');
    const cats = normalize(p.categories || '');
    return fuzzyHit(qNorm, name) || fuzzyHit(qNorm, variant) || fuzzyHit(qNorm, cats);
  });
  if (results.length) {
    logger.info({ query, hits: results.length }, 'Fuzzy match encontró resultados');
    return prioritize(results);
  }

  // 3) IA keyword fallback con prompt desde config.csv
  if (process.env.OPENAI_API_KEY) {
    try {
      const cfg = await readBotConfig();
      const parserPrompt = cfg.prompt_product_parser ||
        "Sos un parser. Dado un texto del usuario, devolveme SOLO una palabra clave de producto o categoría de carnicería (ej.: asado, vacío, nalga, milanesa, pollo, cerdo, parrilla, empanizado). No inventes.";

      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const aiRes = await client.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: "system", content: parserPrompt },
          { role: "user", content: query }
        ],
        temperature: 0.2,
        max_tokens: 12
      });
      const keyword = (aiRes.choices?.[0]?.message?.content || '').toLowerCase().trim();
      if (keyword) {
        logger.info({ query, keyword }, 'IA sugirió keyword para búsqueda');
        results = stock.filter(p => {
          const name = normalize(p.name || '');
          const variant = normalize(p.variant || '');
          const cats = normalize(p.categories || '');
          return name.includes(keyword) || variant.includes(keyword) || cats.includes(keyword);
        });
        if (results.length) return prioritize(results);
      }
    } catch (e) {
      logger.warn({ e }, 'IA keyword fallback failed');
    }
  }

  return [];
}

module.exports = { readStock, findProducts };
