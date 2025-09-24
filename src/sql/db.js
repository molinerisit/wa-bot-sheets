
import { Sequelize } from 'sequelize';
import 'dotenv/config';

const databaseUrl = process.env.DATABASE_URL;
if(!databaseUrl) throw new Error('DATABASE_URL no definido');

export const sequelize = new Sequelize(databaseUrl, {
  dialect: 'postgres',
  logging: false
});

export async function ensureSchemas() {
  await sequelize.query('CREATE SCHEMA IF NOT EXISTS bot');
  await sequelize.query('CREATE SCHEMA IF NOT EXISTS shop');
}
