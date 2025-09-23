const axios = require('axios');
const { logger } = require('./utils/logger');

const base = () => `${process.env.EVO_URL}`.replace(/\/+$/,'');
const instance = () => process.env.EVO_INSTANCE;
const headers = () => ({ apikey: process.env.EVO_TOKEN });

async function sendText(to, text) {
  await axios.post(`${base()}/message/sendText/${instance()}`, {
    number: to,
    options: { delay: 0 },
    text
  }, { headers: headers() });
}

async function sendMedia(to, imageUrl, caption = '') {
  // Evolution soporta envío por URL (no hace falta subir archivo)
  await axios.post(`${base()}/message/sendMedia/${instance()}`, {
    number: to,
    mediaType: 'image',
    media: imageUrl,     // URL directa
    caption
  }, { headers: headers() });
}

module.exports = { sendText, sendMedia };
