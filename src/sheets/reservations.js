const { getSheets } = require('./sheets');

const RANGE = 'reservas!A:Z';

async function ensureHeader() {
  const s = getSheets();
  const res = await s.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID, range: RANGE
  });
  if (!res.data.values || res.data.values.length === 0) {
    await s.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'reservas!A1:I1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[
        'id','name','phone','date','time','people','notes','status','created_at'
      ]] }
    });
  }
}

async function createReservation({ name, phone, date, time, people, notes }) {
  await ensureHeader();
  const s = getSheets();
  const id = `${Date.now()}`;
  const created_at = new Date().toISOString();
  const row = [id, name||'', phone||'', date||'', time||'', Number(people||0), notes||'', 'pending', created_at];
  await s.spreadsheets.values.append({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: RANGE,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });
  return { id, status: 'pending' };
}


async function ensureHeader() {
  const s = getSheets();
  const res = await s.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID, range: RANGE
  });
  if (!res.data.values || res.data.values.length === 0) {
    await s.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'reservas!A1:I1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[
        'id','name','phone','date','time','people','notes','status','created_at'
      ]] }
    });
  }
}

async function createReservation({ name, phone, date, time, people, notes }) {
  await ensureHeader();
  const s = getSheets();
  const id = `${Date.now()}`;
  const created_at = new Date().toISOString();
  const row = [id, name||'', phone||'', date||'', time||'', Number(people||0), notes||'', 'pending', created_at];
  await s.spreadsheets.values.append({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: RANGE,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });
  return { id, status: 'pending' };
}

async function readReservations() {
  const s = getSheets();
  const res = await s.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID, range: RANGE
  });
  const values = res.data.values || [];
  const [headers, ...rows] = values;
  if (!headers) return [];
  return rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

module.exports = { createReservation, readReservations };
