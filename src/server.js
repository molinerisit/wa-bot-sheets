require('dotenv').config();
const express = require('express');
const { logger } = require('./utils/logger');
const { handleIncoming } = require('./bot/engine');
const adminRoutes = require('./routes-bot');

const app = express();
app.use(express.json({ limit: '2mb' }));

// Health
app.get('/health', (_req, res) => res.json({ ok: true }));

// Webhook Evolution
app.post('/wa/webhook', async (req, res) => {
  try {
    const token = req.query.token || req.headers['x-webhook-token'];
    if (process.env.WEBHOOK_TOKEN && token && token !== process.env.WEBHOOK_TOKEN) {
      return res.status(403).json({ error: 'invalid token' });
    }

    // Evolution a veces envía arrays de mensajes; manejamos ambos
    const payload = req.body;
    const events = Array.isArray(payload) ? payload : [payload];
    for (const ev of events) {
      // Evolution puede anidar el contenido dentro de ev.message, ev.data, etc.
      const body = ev?.message || ev?.data || ev;
      await handleIncoming(body);
    }
    res.sendStatus(200);
  } catch (e) {
    logger.error({ err: e, body: req.body }, 'webhook error');
    res.sendStatus(200);
  }
});

// Admin routes
app.use('/', adminRoutes);

const port = Number(process.env.PORT || 3000);
app.listen(port, () => logger.info({ port }, 'WA bot listening'));
