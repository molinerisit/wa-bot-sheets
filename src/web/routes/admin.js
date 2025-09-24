
import { Router } from 'express';
import { Intent, Synonym, Category, Product, Rule, Role } from '../../sql/models/index.js';

const r = Router();
r.get('/intents', async (_,res)=> res.json(await Intent.findAll()));
r.post('/intents', async (req,res)=>{
  const created = await Intent.create(req.body);
  res.json(created);
});

r.get('/synonyms', async (_,res)=> res.json(await Synonym.findAll()));
r.post('/synonyms', async (req,res)=> res.json(await Synonym.create(req.body)));

r.get('/categories', async(_,res)=> res.json(await Category.findAll()));
r.post('/categories', async(req,res)=> res.json(await Category.create(req.body)));

r.get('/products', async(_,res)=> res.json(await Product.findAll()));
r.post('/products', async(req,res)=> res.json(await Product.create(req.body)));

r.get('/roles', async(_,res)=> res.json(await Role.findAll()));
r.post('/roles', async(req,res)=> res.json(await Role.create(req.body)));

r.get('/rules', async(_,res)=> res.json(await Rule.findAll()));
r.post('/rules', async(req,res)=> res.json(await Rule.create(req.body)));

export default r;
