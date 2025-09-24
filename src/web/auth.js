
export function adminAuth(req, res, next){
  const token = req.headers['x-admin-token'] || '';
  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected) return res.status(500).json({error:'ADMIN_TOKEN_not_set'});
  if (token !== expected) return res.status(401).json({error:'unauthorized'});
  next();
}
