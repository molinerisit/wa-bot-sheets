
import { Router } from 'express';
import { handleIncoming } from '../../bot/engine.js';
const r = Router();

r.post('/webhook', async (req, res) => {
  const { channel='web', user_id='anon', text='' } = req.body || {};
  try {
    const reply = await handleIncoming({ channel, user_id, text });
    res.json({ reply });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'engine_error', detail: e.message });
  }
});

export default r;
