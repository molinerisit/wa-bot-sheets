const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { google } = require('googleapis');
const OpenAI = require('openai');
const { logger } = require('../utils/logger');

const STOCK_PATH = path.join(process.cwd(), 'stock.csv');

function normalizeSearchText(q) {
  return (q || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos
    .replace(/\b(tenes|tienes|quiero|quisiera|hay|mostrame|muestrame|mostrame|mostra|decime|necesito)\b/g, '')
    .trim()
    .replace(/s\b/, ''); // plurales simples → singular
}

// --- Leer stock CSV ---
function readStock() {
  return new Promise((resolve, reject) => {
    try {
      const text = fs.readFileSync(STOCK_PATH, 'utf8');
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      resolve(parsed.data.map(r => ({
        sku: r.sku,
        name: r.name,
        variant: r.variant || '',
        price: Number(r.price) || 0,
        qty_available: Number(r.qty_available) || 0,
        categories: r.categories || '',
        image_url: r.image_url || ''
      })));
    } catch (e) {
      reject(e);
    }
  });
}

// --- Buscar productos ---
async function findProducts(query, category) {
  const qNorm = normalizeSearchText(query);
  const stock = await readStock();

  // 1) búsqueda exacta por nombre/variante/categoría
  let results = stock.filter(p => {
    const name = (p.name || '').toLowerCase();
    const variant = (p.variant || '').toLowerCase();
    const cats = (p.categories || '').toLowerCase();
    return (
      (qNorm && (name.includes(qNorm) || variant.includes(qNorm))) ||
      (category && cats.includes(category.toLowerCase()))
    );
  });

  if (results.length) return results;

  // 2) Si no hubo resultados → usar IA para sugerir un alias/categoría
  if (process.env.OPENAI_API_KEY) {
    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const aiRes = await client.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: "system", content: "Sos un parser. Dado un texto del usuario, devolveme SOLO una palabra clave de producto o categoría de carnicería. Ej: 'tenes algo para la parrilla?' → 'parrilla' o 'asado'." },
          { role: "user", content: query }
        ],
        temperature: 0.2,
        max_tokens: 10
      });
      const keyword = aiRes.choices?.[0]?.message?.content?.toLowerCase().trim();
      if (keyword) {
        logger.info({ query, keyword }, 'IA sugirió keyword para búsqueda');
        results = stock.filter(p =>
          (p.name || '').toLowerCase().includes(keyword) ||
          (p.variant || '').toLowerCase().includes(keyword) ||
          (p.categories || '').toLowerCase().includes(keyword)
        );
      }
    } catch (e) {
      logger.warn({ e }, 'IA keyword fallback failed');
    }
  }

  return results;
}

module.exports = { readStock, findProducts };
