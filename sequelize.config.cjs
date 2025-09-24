
const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  production: {
    use_env_variable: 'DATABASE_URL',
    dialect: 'postgres',
    logging: false
  },
  development: {
    use_env_variable: 'DATABASE_URL',
    dialect: 'postgres',
    logging: console.log
  },
  test: {
    use_env_variable: 'DATABASE_URL',
    dialect: 'postgres',
    logging: false
  }
};
