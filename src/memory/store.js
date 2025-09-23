// src/memory/store.js
const { logger } = require('../utils/logger');

let mem = new Map();
let redis = null;

// TTL de la sesión (en segundos). Por defecto 2 días.
const TTL = Number(process.env.MEMORY_TTL_SECONDS || 172800);

async function initRedisIfNeeded() {
  if (process.env.REDIS_URL && !redis) {
    try {
      const IORedis = require('ioredis');
      redis = new IORedis(process.env.REDIS_URL);
      redis.on('error', (e) => logger.error({ e }, 'redis error'));
    } catch (e) {
      logger.warn('ioredis no instalado o REDIS_URL inválida; usando memoria en proceso');
      redis = null;
    }
  }
  return redis;
}

function key(uid) { return `sess:${uid}`; }

async function getSession(uid) {
  await initRedisIfNeeded();
  if (redis) {
    const raw = await redis.get(key(uid));
    if (raw) return JSON.parse(raw);
    const fresh = { userId: uid, last_product: null, cart: [], reservation: {}, history: [] };
    await redis.set(key(uid), JSON.stringify(fresh), 'EX', TTL);
    return fresh;
  }
  if (!mem.has(uid)) {
    mem.set(uid, { userId: uid, last_product: null, cart: [], reservation: {}, history: [], _ts: Date.now() });
  }
  return mem.get(uid);
}

async function saveSession(uid, data) {
  await initRedisIfNeeded();
  if (redis) {
    await redis.set(key(uid), JSON.stringify(data), 'EX', TTL);
    return;
  }
  mem.set(uid, { ...data, _ts: Date.now() });
}

async function clearSession(uid) {
  await initRedisIfNeeded();
  if (redis) await redis.del(key(uid));
  mem.delete(uid);
}

module.exports = { getSession, saveSession, clearSession };
