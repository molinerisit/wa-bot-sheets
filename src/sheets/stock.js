const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { logger } = require('../utils/logger');
const { readBotConfig } = require('./config');
const { getSheets } = require('./sheets'); // helper existente para Google Sheets

// Intenta varias rutas razonables para stock.csv
function candidateCsvPaths() {
  return [
    path.join(process.cwd(), 'stock.csv'),
    path.join(__dirname, '..', '..', 'stock.csv'),
    path.join(__dirname, '..', 'stock.csv')
  ];
}

function normalizeSearchText(q) {
  return (q || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // quita acentos
    .replace(/\b(tenes|tienes|quiero|quisiera|hay|mostrame|muestrame|mostra|decime|necesito|me|para|la|el|de|unas|unos|un|una)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/s\b/, ''); // plural simple → singular
}

// ---------- Lectores de stock ----------
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
  // 1) Sheets si hay credenciales
  try {
    const rows = await readStockFromSheets();
    if (rows.length) {
      logger.info({ source: 'sheets', count: rows.length }, 'Stock OK');
      return rows;
    }
  } catch (e) {
    logger.warn({ e }, 'Falla leyendo Sheets, intento CSV');
  }
  // 2) CSV local
  try {
    const rows = readStockFromCsvSync();
    if (rows.length) {
      logger.info({ source: 'csv', count: rows.length }, 'Stock OK');
      return rows;
    }
  } catch (e) {
    logger.warn({ e }, 'Falla leyendo CSV');
  }
  // 3) Vacío (pero no rompas el flujo)
  logger.warn('Stock vacío (ni Sheets ni CSV).');
  return [];
}

// ---------- Buscador ----------
async function findProducts(query, category) {
  const qNorm = normalizeSearchText(query);
  const catNorm = (category || '').toLowerCase();
  const stock = await readStock();

  // 1) Filtro literal rápido
  let results = stock.filter(p => {
    const name = (p.name || '').toLowerCase();
    const variant = (p.variant || '').toLowerCase();
    const cats = (p.categories || '').toLowerCase();
    const nameHit = qNorm && (name.includes(qNorm) || variant.includes(qNorm));
    const catHit = catNorm && cats.includes(catNorm);
    return nameHit || catHit;
  });

  if (results.length) return results;

  // 2) IA keyword fallback desde config.csv
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
      const keyword = aiRes.choices?.[0]?.message?.content?.toLowerCase().trim();
      if (keyword) {
        logger.info({ query, keyword }, 'IA sugirió keyword para búsqueda');
        results = stock.filter(p => {
          const name = (p.name || '').toLowerCase();
          const variant = (p.variant || '').toLowerCase();
          const cats = (p.categories || '').toLowerCase();
          return name.includes(keyword) || variant.includes(keyword) || cats.includes(keyword);
        });
      }
    } catch (e) {
      logger.warn({ e }, 'IA keyword fallback failed');
    }
  }

  return results;
}

module.exports = { readStock, findProducts };
