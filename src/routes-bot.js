const express = require('express');
const { readStock, upsertStockBySku } = require('./sheets/stock');

const router = express.Router();

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

module.exports = router;
