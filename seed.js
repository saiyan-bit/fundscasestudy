const bcrypt = require('bcryptjs');
const { pool } = require('./db/index');
const migrate = require('./db/migrate');

async function seed() {
  await migrate();
  
  const client = await pool.connect();
  try {
    console.log('Seeding data...');
    await client.query('BEGIN');

    const adminPasswordHash = await bcrypt.hash('admin123', 10);
    const salesPasswordHash = await bcrypt.hash('sales123', 10);

    await client.query(`
      INSERT INTO users (username, email, password_hash, role, full_name)
      VALUES 
        ('admin', 'admin@company.com', $1, 'ADMIN', 'System Administrator'),
        ('sales', 'sales@company.com', $2, 'SALES', 'Sales Executive')
      ON CONFLICT (username) DO NOTHING
    `, [adminPasswordHash, salesPasswordHash]);

    await client.query(`
      INSERT INTO products (product_code, product_name, category, unit, base_price)
      VALUES 
        ('IND-P-001', 'Heavy Duty Ball Bearing 6205', 'Bearings', 'Piece', 450.00),
        ('IND-P-002', 'Industrial V-Belt B-Section', 'Belts', 'Meter', 125.00),
        ('IND-P-003', 'Hydraulic Pump 5HP', 'Hydraulics', 'Unit', 28500.00),
        ('IND-P-004', 'MS Pipe 2 Inch Schedule 40', 'Pipes', 'Meter', 320.00),
        ('IND-P-005', 'Electric Motor 3HP 3-Phase', 'Motors', 'Unit', 15750.00),
        ('IND-P-006', 'Stainless Steel Flange 4"', 'Flanges', 'Piece', 890.00)
      ON CONFLICT (product_code) DO NOTHING
      RETURNING id, product_code
    `);

    const products = await client.query(`
      SELECT id, product_code FROM products ORDER BY product_code
    `);

    for (let i = 0; i < products.rows.length; i++) {
      const quantities = [250, 500, 30, 400, 45, 180];
      await client.query(`
        INSERT INTO inventory (product_id, physical_quantity, reserved_quantity)
        VALUES ($1, $2, 0)
        ON CONFLICT (product_id) DO UPDATE SET physical_quantity = $2
      `, [products.rows[i].id, quantities[i]]);
    }

    await client.query(`
      INSERT INTO customers (company_name, contact_person, mobile, email, city)
      VALUES 
        ('ABC Engineering Pvt. Ltd.', 'Rajesh Kumar', '9876543210', 'rajesh@abceng.com', 'Pune'),
        ('XYZ Manufacturing Co.', 'Amit Sharma', '9988776655', 'amit@xyzmfg.in', 'Mumbai')
      ON CONFLICT (company_name) DO NOTHING
    `);

    await client.query('COMMIT');
    console.log('Seed completed successfully!');
    console.log('\nTest Credentials:');
    console.log('  ADMIN  -> username: admin, password: admin123');
    console.log('  SALES  -> username: sales, password: sales123');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  seed().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = seed;
