const { getSheets } = require('./sheets');

function rowToObj(headers, row) {
  const obj = Object.fromEntries(headers.map((h,i)=>[h, row[i] ?? '']));
  obj.qty_available = Number(obj.qty_available || 0);
  obj.price = Number(obj.price || 0);
  obj.cost = Number(obj.cost || 0);
  obj.min_qty = Number(obj.min_qty || 0);
  obj.categories = String(obj.categories || '').toLowerCase();
  return obj;
}

async function readStock() {
  const s = getSheets();
  const res = await s.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'stock!A:Z'
  });
  const values = res.data.values || [];
  const [headers, ...rows] = values;
  if (!headers) return [];
  return rows.map(r => rowToObj(headers, r));
}

function normalize(text) {
  return String(text || '').toLowerCase();
}

function matchesQuery(p, q) {
  const t = `${p.name} ${p.variant || ''} ${p.categories || ''}`.toLowerCase();
  return q.split(/\s+/).filter(Boolean).every(w => t.includes(w));
}

function matchesCategory(p, cat) {
  if (!cat) return false;
  const tags = (p.categories || '').split(/[;,|]/).map(x => x.trim());
  return tags.includes(cat.toLowerCase());
}

function sortPreferInStock(list) {
  return list.slice().sort((a,b) => {
    const aIn = a.qty_available > 0 ? 1 : 0;
    const bIn = b.qty_available > 0 ? 1 : 0;
    if (bIn !== aIn) return bIn - aIn; // primero con stock
    return a.price - b.price;          // luego el más económico
  });
}

async function findProducts(query, normalizedCategory) {
  const all = await readStock();
  const q = normalize(query);

  let filtered = all.filter(p => (p.status || 'active') !== 'hidden');

  // Si hay categoría detectada, filtramos por categoría
  if (normalizedCategory) {
    const byCat = filtered.filter(p => matchesCategory(p, normalizedCategory));
    if (byCat.length) return sortPreferInStock(byCat);
  }

  // Si no, buscamos por texto (nombre/variante/categorías)
  if (q) filtered = filtered.filter(p => matchesQuery(p, q));

  return sortPreferInStock(filtered);
}

module.exports = { readStock, findProducts };
