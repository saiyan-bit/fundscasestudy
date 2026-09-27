const { pool } = require('./index');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Running migrations...');
    
    await client.query('BEGIN');

    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'SALES')),
        full_name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_name VARCHAR(200) NOT NULL,
        contact_person VARCHAR(100) NOT NULL,
        mobile VARCHAR(20) NOT NULL,
        email VARCHAR(100),
        city VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_code VARCHAR(50) UNIQUE NOT NULL,
        product_name VARCHAR(200) NOT NULL,
        category VARCHAR(100) NOT NULL,
        unit VARCHAR(20) NOT NULL,
        base_price DECIMAL(12, 2) NOT NULL CHECK (base_price >= 0),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID UNIQUE NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        physical_quantity INTEGER NOT NULL DEFAULT 0 CHECK (physical_quantity >= 0),
        reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
        version INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS enquiries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        enquiry_number VARCHAR(50) UNIQUE NOT NULL,
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
        enquiry_date DATE NOT NULL,
        required_date DATE,
        notes TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'QUOTED', 'WON', 'LOST')),
        created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS enquiry_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        enquiry_id UUID NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (enquiry_id, product_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS quotations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        quotation_number VARCHAR(50) UNIQUE NOT NULL,
        enquiry_id UUID NOT NULL REFERENCES enquiries(id) ON DELETE RESTRICT,
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
        valid_until DATE,
        grand_total DECIMAL(14, 2) NOT NULL DEFAULT 0 CHECK (grand_total >= 0),
        status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED')),
        created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS quotation_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price DECIMAL(12, 2) NOT NULL CHECK (unit_price >= 0),
        discount_percent DECIMAL(5, 2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
        gst_percent DECIMAL(5, 2) NOT NULL DEFAULT 0 CHECK (gst_percent >= 0 AND gst_percent <= 100),
        line_amount DECIMAL(14, 2) NOT NULL CHECK (line_amount >= 0),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (quotation_id, product_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sales_orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_number VARCHAR(50) UNIQUE NOT NULL,
        quotation_id UUID UNIQUE NOT NULL REFERENCES quotations(id) ON DELETE RESTRICT,
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
        order_date DATE NOT NULL,
        total_amount DECIMAL(14, 2) NOT NULL CHECK (total_amount >= 0),
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'DISPATCHED', 'CANCELLED')),
        created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        confirmed_at TIMESTAMP,
        confirmed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sales_order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price DECIMAL(12, 2) NOT NULL CHECK (unit_price >= 0),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (sales_order_id, product_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS dispatches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        dispatch_number VARCHAR(50) UNIQUE NOT NULL,
        sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE RESTRICT,
        dispatch_date DATE NOT NULL,
        vehicle_number VARCHAR(50),
        driver_name VARCHAR(100),
        created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS dispatch_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        dispatch_id UUID NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
        sales_order_item_id UUID NOT NULL REFERENCES sales_order_items(id) ON DELETE RESTRICT,
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION check_inventory_reservation()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.reserved_quantity > NEW.physical_quantity THEN
          RAISE EXCEPTION 'Reserved quantity cannot exceed physical quantity';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DROP TRIGGER IF EXISTS trigger_check_inventory_reservation ON inventory;
      CREATE TRIGGER trigger_check_inventory_reservation
      BEFORE UPDATE OR INSERT ON inventory
      FOR EACH ROW EXECUTE FUNCTION check_inventory_reservation();
    `);

    await client.query('COMMIT');
    console.log('Migrations completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrate().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = migrate;
