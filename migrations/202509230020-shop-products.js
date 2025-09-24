
'use strict';
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS shop.products(
        id SERIAL PRIMARY KEY,
        sku TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        price NUMERIC(10,2) NOT NULL DEFAULT 0,
        stock INT NOT NULL DEFAULT 0,
        category TEXT
      );
    `);
  },
  async down (queryInterface, Sequelize) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS shop.products;');
  }
};
