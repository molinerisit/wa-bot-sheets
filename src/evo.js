const axios = require('axios');
const { logger } = require('./utils/logger');

const EVO_URL = process.env.EVO_URL;
const EVO_TOKEN = process.env.EVO_TOKEN;
const EVO_INSTANCE = process.env.EVO_INSTANCE;

async function sendText(to, text) {
  const url = `${EVO_URL}/message/sendText/${EVO_INSTANCE}`;
  const payload = { number: to, options: { delay: 0 }, text };
  await axios.post(url, payload, { headers: { apikey: EVO_TOKEN } })
    .catch(err => {
      logger.error({ err: err.response?.data || err.message }, 'evo.sendText error');
      throw err;
    });
}

async function sendMedia(to, urlMedia, caption) {
  const url = `${EVO_URL}/message/sendFile/${EVO_INSTANCE}`;
  const payload = { number: to, options: { delay: 0 }, path: urlMedia, caption: caption || '' };
  await axios.post(url, payload, { headers: { apikey: EVO_TOKEN } })
    .catch(err => {
      logger.error({ err: err.response?.data || err.message }, 'evo.sendMedia error');
      throw err;
    });
}

module.exports = { sendText, sendMedia };
