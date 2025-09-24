
'use strict';

module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.sequelize.query('CREATE SCHEMA IF NOT EXISTS bot');
    await queryInterface.sequelize.query('CREATE SCHEMA IF NOT EXISTS shop');
  },
  async down (queryInterface, Sequelize) {
    await queryInterface.sequelize.query('DROP SCHEMA IF EXISTS shop CASCADE');
    await queryInterface.sequelize.query('DROP SCHEMA IF EXISTS bot CASCADE');
  }
};
