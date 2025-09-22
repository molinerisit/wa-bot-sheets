const { getSheets } = require('./sheets');

async function readBotConfig() {
  const s = getSheets();
  const res = await s.spreadsheets.values.get({ spreadsheetId: process.env.SPREADSHEET_ID, range: 'config!A:B' });
  const rows = res.data.values || [];
  const map = {};
  for (const [k, v] of (rows.slice(1) || [])) {
    if (!k) continue;
    try {
      const t = (v || '').trim();
      map[k] = (t.startsWith('{') || t.startsWith('[')) ? JSON.parse(t) : t;
    } catch {
      map[k] = v;
    }
  }
  map.bot_name = map.bot_name || 'Bot';
  map.greeting_template = map.greeting_template || '¡Hola! Soy {{bot_name}}. ¿Qué buscás hoy?';
  map.oos_template = map.oos_template || 'No lo tengo ahora mismo.';
  map.synonyms = map.synonyms || {};
  map.intents = map.intents || [{ name: 'consulta_stock', examples: ['tenés','stock','precio'] }];
  return map;
}

module.exports = { readBotConfig };
