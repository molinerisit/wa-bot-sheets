const express = require('express');
const { readStock, upsertStockBySku } = require('./sheets/stock');
const { readBotConfig } = require('./sheets/config');
const { readAgenda } = require('./sheets/availability');
const { readReservations } = require('./sheets/reservations');

const router = express.Router();

// STOCK
router.get('/admin/stock', async (_req, res) => {
  try {
    const items = await readStock();
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

router.post('/admin/stock', express.json(), async (req, res) => {
  try {
    const { sku, patch } = req.body || {};
    if (!sku || !patch) return res.status(400).json({ error: 'sku & patch required' });
    await upsertStockBySku(sku, patch);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// CONFIG
router.get('/admin/config', async (_req, res) => {
  try {
    const cfg = await readBotConfig();
    res.json({ config: cfg });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 👉 AGENDA (disponibilidades)
router.get('/admin/agenda', async (_req, res) => {
  try {
    const agenda = await readAgenda();
    res.json({ agenda });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 👉 RESERVAS (listado)
router.get('/admin/reservas', async (_req, res) => {
  try {
    const reservas = await readReservations();
    res.json({ reservas });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

module.exports = router;
