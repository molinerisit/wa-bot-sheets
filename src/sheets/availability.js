const { getSheets } = require('./sheets');

const RANGE = 'agenda!A:D'; // date, time, capacity, booked

async function readAgenda() {
  const s = getSheets();
  const res = await s.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID, range: RANGE
  });
  const [headers, ...rows] = res.data.values || [];
  if (!headers) return [];
  return rows.map(r => Object.fromEntries(headers.map((h,i)=>[h, r[i] ?? ''])))
             .map(x => ({
               date: x.date, time: x.time,
               capacity: Number(x.capacity || 0),
               booked: Number(x.booked || 0)
             }));
}

async function checkAvailability(date, time, people = 1) {
  const slots = await readAgenda();
  const match = slots.find(s => s.date === date && s.time === time);
  if (!match) return { available: false, reason: 'no_slot_defined' };
  const ok = (match.booked + Number(people || 0)) <= match.capacity;
  return { available: ok, slot: match };
}

module.exports = { checkAvailability, readAgenda };
