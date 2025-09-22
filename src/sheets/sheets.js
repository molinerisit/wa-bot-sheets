const { google } = require('googleapis');

let sheets;
function getSheets() {
  if (sheets) return sheets;

  const scopes = ['https://www.googleapis.com/auth/spreadsheets'];

  // SOLO variables de entorno (email + private key con \n)
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const keyRaw = process.env.GOOGLE_PRIVATE_KEY || '';
  // convertir \n escapados a saltos reales
  const key = keyRaw.replace(/\\n/g, '\n');

  if (!email || !key) {
    throw new Error('Faltan GOOGLE_CLIENT_EMAIL o GOOGLE_PRIVATE_KEY en el .env');
  }

  const auth = new google.auth.JWT({ email, key, scopes });
  sheets = google.sheets({ version: 'v4', auth });
  return sheets;
}

module.exports = { getSheets };
