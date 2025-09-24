
import { Product, Rule } from '../sql/models/index.js';
import { replaceSynonyms } from './nlu.js';

export async function listProducts(queryText='') {
  const q = await replaceSynonyms(queryText);
  if (!q) return await Product.findAll({ limit: 10, order:[['name','ASC']] });
  const { Op } = await import('sequelize');
  return await Product.findAll({
    where: { name: { [Op.iLike]: '%' + q + '%' } },
    order: [['name','ASC']],
    limit: 20
  });
}

export async function applyRules(products, ctx={}) {
  const rules = await Rule.findAll();
  if (!rules.length) return products.map(p=>p.toJSON());

  const out = products.map(p=>p.toJSON());
  for (const r of rules) {
    const def = r.definition || {};
    for (const p of out) {
      if (def.when?.category && def.when.category === p.category) {
        if (def.action?.discount_pct) {
          p._discount = def.action.discount_pct;
          const priceNum = Number(p.price);
          p.price = (priceNum * (100 - p._discount) / 100).toFixed(2);
        }
      }
    }
  }
  return out;
}
