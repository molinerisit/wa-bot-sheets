require('dotenv').config();
const express = require('express');
const { logger } = require('./utils/logger');
const { handleIncoming } = require('./bot/engine');
const adminRoutes = require('./routes-bot');

const app = express();
app.use(express.json({ limit: '2mb' }));

// Health
app.get('/health', (_req, res) => res.json({ ok: true }));

// Webhook Evolution (recibe eventos)
app.post('/wa/webhook', async (req, res) => {
  try {
    // Validación simple de token (opcional)
    const token =
      req.query.token ||
      req.headers['x-webhook-token'] ||
      req.headers['authorization'];

    if (process.env.WEBHOOK_TOKEN && token && token !== process.env.WEBHOOK_TOKEN) {
      return res.status(403).json({ error: 'invalid token' });
    }

    const payload = req.body;
    const events = Array.isArray(payload) ? payload : [payload];

    for (const ev of events) {
      // Pasamos el evento COMPLETO y el engine se encarga de normalizar
      await handleIncoming(ev);
    }

    res.sendStatus(200);
  } catch (e) {
    logger.error({ err: e, body: req.body }, 'webhook error');
    // devolvemos 200 igual para que Evolution no reintente infinitamente
    res.sendStatus(200);
  }
});

// Endpoints admin (CRUD stock)
app.use('/', adminRoutes);

const port = Number(process.env.PORT || 3000);
app.listen(port, () => logger.info({ port }, 'WA bot listening'));
