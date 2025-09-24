
'use strict';
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS bot.configs(
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bot.intents(
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        training_phrases TEXT[] DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS bot.synonyms(
        id SERIAL PRIMARY KEY,
        canonical TEXT NOT NULL,
        variants TEXT[] DEFAULT '{}'::TEXT[]
      );
      CREATE TABLE IF NOT EXISTS bot.categories(
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bot.business_hours(
        id SERIAL PRIMARY KEY,
        day_of_week INT NOT NULL,
        open TEXT NOT NULL,
        close TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bot.roles(
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        capabilities TEXT[] DEFAULT '{}'::TEXT[]
      );
      CREATE TABLE IF NOT EXISTS bot.rules(
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        definition JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bot.conversations(
        id SERIAL PRIMARY KEY,
        channel TEXT NOT NULL,
        user_id TEXT NOT NULL,
        state JSONB DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS bot.messages(
        id SERIAL PRIMARY KEY,
        conversation_id INT NOT NULL REFERENCES bot.conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL
      );
    `);
  },
  async down (queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS bot.messages;
      DROP TABLE IF EXISTS bot.conversations;
      DROP TABLE IF EXISTS bot.rules;
      DROP TABLE IF EXISTS bot.roles;
      DROP TABLE IF EXISTS bot.business_hours;
      DROP TABLE IF EXISTS bot.categories;
      DROP TABLE IF EXISTS bot.synonyms;
      DROP TABLE IF EXISTS bot.intents;
      DROP TABLE IF EXISTS bot.configs;
    `);
  }
};
