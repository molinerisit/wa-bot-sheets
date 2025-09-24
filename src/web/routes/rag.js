
import { Router } from 'express';
import { upsertDocument, listDocuments, deleteDocument } from '../../rag/service.js';
import { BotConfig } from '../../sql/models/index.js';

const r = Router();

r.get('/docs', async (_,res)=>{
  res.json(await listDocuments());
});

r.post('/docs', async (req,res)=>{
  const { title, tags=[], text } = req.body || {};
  if(!title || !text) return res.status(400).json({error:'title_and_text_required'});
  const out = await upsertDocument({ title, tags, text });
  res.json(out);
});

r.delete('/docs/:id', async (req,res)=>{
  await deleteDocument(Number(req.params.id));
  res.json({ok:true});
});

// External DB connector config (stored in bot.configs)
r.post('/external-db', async (req,res)=>{
  const { url, allowed_sql=[] } = req.body || {};
  if(!url) return res.status(400).json({error:'url_required'});
  await BotConfig.upsert({ key:'external_db_url', value:url });
  await BotConfig.upsert({ key:'external_allowed_sql', value: JSON.stringify(allowed_sql) });
  res.json({ok:true});
});

r.get('/external-db', async (_,res)=>{
  const rows = await BotConfig.findAll({ where: { key: ['external_db_url','external_allowed_sql'] } });
  const cfg = Object.fromEntries(rows.map(r=>[r.key, r.value]));
  res.json(cfg);
});

export default r;
