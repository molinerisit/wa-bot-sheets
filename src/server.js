
import 'dotenv/config';
import express from 'express';
import { sequelize, ensureSchemas } from './sql/db.js';
import router from './web/index.js';

const app = express();
app.use(express.json());

app.get('/health', (req,res)=>res.json({ok:true}));

app.use('/', router);

const PORT = process.env.PORT || 8080;

(async () => {
  try {
    await sequelize.authenticate();
    await ensureSchemas();
    console.log('DB ok');
    app.listen(PORT, () => console.log(`Server on :${PORT}`));
  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
})();
