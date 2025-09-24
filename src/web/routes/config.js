
import { Router } from 'express';
import { BotConfig } from '../../sql/models/index.js';

const r = Router();

r.get('/', async (req,res)=>{
  const rows = await BotConfig.findAll();
  const cfg = Object.fromEntries(rows.map(r=>[r.key, r.value]));
  res.json({config: cfg});
});

r.post('/', async (req,res)=>{
  const updates = req.body || {};
  for(const [k,v] of Object.entries(updates)){
    await BotConfig.upsert({key:k, value: typeof v === 'string'? v : JSON.stringify(v)});
  }
  res.json({ok:true});
});

export default r;
