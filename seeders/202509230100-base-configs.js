
'use strict';
module.exports = {
  async up (queryInterface, Sequelize) {
    const entries = [
      ['bot_name','Cibergaucho Bot'],
      ['language','es'],
      ['timezone','America/Argentina/Cordoba'],
      ['greeting_template','{{greeting}} Soy {{bot_name}}. ¿En qué puedo ayudarte hoy?'],
      ['oos_template','Perdón, no entendí. ¿Podés reformular o elegir una opción?'],
      ['ecommerce_url','https://example.com'],
      ['response_mode','concise'],
      ['agent_role','sales'],
      ['business_hours','[{"day":1,"open":"09:00","close":"18:00"}]']
    ];
    for (const [key, value] of entries) {
      await queryInterface.sequelize.query(`
        INSERT INTO bot.configs(key, value) VALUES ($$${key}$$, $$${value}$$)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
      `);
    }
    await queryInterface.sequelize.query(`
      INSERT INTO bot.intents(name, description, training_phrases)
      VALUES
      ('greeting','Saludo inicial', ARRAY['hola','buenas','qué tal']),
      ('search_product','Buscar productos', ARRAY['tenés milanesas?','busco ribeye','ofertas carne']),
      ('buy','Comprar / armar pedido', ARRAY['quiero 2kg','agregá al carrito','lo llevo']),
      ('hours','Horarios', ARRAY['cuándo abren','horario de atención'])
      ON CONFLICT (name) DO NOTHING;
    `);
    await queryInterface.sequelize.query(`
      INSERT INTO bot.synonyms(canonical, variants) VALUES
      ('carne', ARRAY['carnes','vacuno','res']),
      ('milanesa', ARRAY['mila','empanado']),
      ('matambre', ARRAY['entraña falsa'])
      ON CONFLICT DO NOTHING;
    `);
    await queryInterface.sequelize.query(`
      INSERT INTO bot.categories(name) VALUES
      ('Carnes'),('Fiambres'),('Congelados')
      ON CONFLICT DO NOTHING;
    `);
    await queryInterface.sequelize.query(`
      INSERT INTO bot.business_hours(day_of_week, open, close) VALUES
      (1,'09:00','19:00'),
      (2,'09:00','19:00'),
      (3,'09:00','19:00'),
      (4,'09:00','19:00'),
      (5,'09:00','20:00'),
      (6,'09:00','13:00');
    `);
    await queryInterface.sequelize.query(`
      INSERT INTO bot.roles(name, capabilities) VALUES
      ('sales', ARRAY['search_product','quote','smalltalk']),
      ('secretary', ARRAY['book_appointment','smalltalk'])
      ON CONFLICT DO NOTHING;
    `);
    await queryInterface.sequelize.query(`
      INSERT INTO bot.rules(name, definition) VALUES
      ('promo_carnes', '{"when":{"category":"Carnes"}, "action":{"discount_pct":10}}')
      ON CONFLICT DO NOTHING;
    `);
    await queryInterface.sequelize.query(`
      INSERT INTO shop.products(sku,name,description,price,stock,category) VALUES
      ('MEAT-001','Milanesa de nalga','Tierna y lista para freír', 5200, 50, 'Carnes'),
      ('MEAT-002','Asado de tira','Ideal para la parrilla', 6800, 30, 'Carnes'),
      ('MEAT-003','Matambre','Clásico argentino', 5900, 15, 'Carnes'),
      ('FROZ-001','Hamburguesas','Caja x 12', 4200, 25, 'Congelados');
    `);
  },
  async down (queryInterface, Sequelize) {
    await queryInterface.sequelize.query('TRUNCATE bot.configs, bot.intents, bot.synonyms, bot.categories, bot.business_hours, bot.roles, bot.rules RESTART IDENTITY CASCADE');
    await queryInterface.sequelize.query('TRUNCATE shop.products RESTART IDENTITY CASCADE');
  }
};
