
import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../db.js';

export class BotConfig extends Model {}
BotConfig.init({
  key: { type: DataTypes.STRING, allowNull:false, unique:true },
  value: { type: DataTypes.TEXT, allowNull:false }
}, { sequelize, modelName:'BotConfig', schema:'bot', tableName:'configs', timestamps:false });

export class Intent extends Model {}
Intent.init({
  name: { type: DataTypes.STRING, allowNull:false, unique:true },
  description: { type: DataTypes.TEXT },
  training_phrases: { type: DataTypes.ARRAY(DataTypes.TEXT), defaultValue: [] }
}, { sequelize, modelName:'Intent', schema:'bot', tableName:'intents' });

export class Synonym extends Model {}
Synonym.init({
  canonical: { type: DataTypes.STRING, allowNull:false },
  variants: { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [] }
},{ sequelize, modelName:'Synonym', schema:'bot', tableName:'synonyms' });

export class Category extends Model {}
Category.init({
  name: { type: DataTypes.STRING, allowNull:false, unique:true }
},{ sequelize, modelName:'Category', schema:'bot', tableName:'categories' });

export class BusinessHour extends Model {}
BusinessHour.init({
  day_of_week: { type: DataTypes.INTEGER, allowNull:false },
  open: { type: DataTypes.STRING, allowNull:false },
  close: { type: DataTypes.STRING, allowNull:false }
}, { sequelize, modelName:'BusinessHour', schema:'bot', tableName:'business_hours' });

export class Role extends Model {}
Role.init({
  name: { type: DataTypes.STRING, allowNull:false, unique:true },
  capabilities: { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [] }
}, { sequelize, modelName:'Role', schema:'bot', tableName:'roles' });

export class Rule extends Model {}
Rule.init({
  name: { type: DataTypes.STRING, allowNull:false, unique:true },
  definition: { type: DataTypes.JSONB, allowNull:false }
}, { sequelize, modelName:'Rule', schema:'bot', tableName:'rules' });

export class Conversation extends Model {}
Conversation.init({
  channel: { type: DataTypes.STRING, allowNull:false },
  user_id: { type: DataTypes.STRING, allowNull:false },
  state: { type: DataTypes.JSONB, defaultValue: {} }
}, { sequelize, modelName:'Conversation', schema:'bot', tableName:'conversations' });

export class Message extends Model {}
Message.init({
  conversation_id: { type: DataTypes.INTEGER, allowNull:false },
  role: { type: DataTypes.STRING, allowNull:false },
  content: { type: DataTypes.TEXT, allowNull:false }
}, { sequelize, modelName:'Message', schema:'bot', tableName:'messages' });

export class Product extends Model {}
Product.init({
  sku: { type: DataTypes.STRING, allowNull:false, unique:true },
  name: { type: DataTypes.STRING, allowNull:false },
  description: { type: DataTypes.TEXT },
  price: { type: DataTypes.DECIMAL(10,2), allowNull:false, defaultValue: 0 },
  stock: { type: DataTypes.INTEGER, allowNull:false, defaultValue: 0 },
  category: { type: DataTypes.STRING }
}, { sequelize, modelName:'Product', schema:'shop', tableName:'products' });
