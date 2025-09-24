
'use strict';
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
    await queryInterface.sequelize.query(`CREATE SCHEMA IF NOT EXISTS rag;`);
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS rag.documents(
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        tags TEXT[] DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS rag.chunks(
        id SERIAL PRIMARY KEY,
        document_id INT REFERENCES rag.documents(id) ON DELETE CASCADE,
        chunk_index INT NOT NULL,
        text TEXT NOT NULL,
        embedding vector(1536)  -- for text-embedding-3-small
      );
    `);
  },
  async down (queryInterface, Sequelize) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS rag.chunks');
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS rag.documents');
    await queryInterface.sequelize.query('DROP SCHEMA IF EXISTS rag CASCADE');
    // no drop extension by default
  }
};
