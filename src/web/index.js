
import { Router } from 'express';
import configRouter from './routes/config.js';
import botRouter from './routes/bot.js';
import adminRouter from './routes/admin.js';
import ragRouter from './routes/rag.js';
import { adminAuth } from './auth.js';
import express from 'express';

const router = Router();

router.use('/ui', express.static('src/web/public'));

// Protected
router.use('/config', adminAuth, configRouter);
router.use('/admin', adminAuth, adminRouter);
router.use('/rag', adminAuth, ragRouter);

// Public webhook
router.use('/bot', botRouter);

export default router;
