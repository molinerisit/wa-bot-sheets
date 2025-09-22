const { getSheets } = require('./sheets');

const RANGE = 'stock!A:Z';

async function readStock() {
  const s = getSheets();
  const res = await s.spreadsheets.values.get({ spreadsheetId: process.env.SPREADSHEET_ID, range: RANGE });
  const values = res.data.values || [];
  const [headers, ...rows] = values;
  if (!headers) return [];
  return rows.map(r => Object.fromEntries(headers.map((h,i)=>[h, r[i] ?? ''])))
             .map(x => ({
               ...x,
               qty_available: Number(x.qty_available||0),
               price: Number(x.price||0)
             }));
}

async function findProducts(query) {
  const q = (query || '').toLowerCase();
  const items = await readStock();
  return items
    .filter(x => (x.status || 'active') !== 'hidden')
    .filter(x => (`${x.name} ${x.variant||''}`).toLowerCase().includes(q));
}

async function upsertStockBySku(sku, patch) {
  const s = getSheets();
  const all = await readStock();
  const idx = all.findIndex(x => x.sku === sku);
  if (idx < 0) throw new Error('SKU no existe');
  const headers = Object.keys(all[0]);
  const rowValues = headers.map(h => (patch && h in patch) ? patch[h] : all[idx][h]);
  const rowNumber = idx + 2; // header = row 1
  await s.spreadsheets.values.update({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `stock!A${rowNumber}:${String.fromCharCode(65 + headers.length - 1)}${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [rowValues] }
  });
}

module.exports = { readStock, findProducts, upsertStockBySku };
