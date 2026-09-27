const express = require('express');
const { body, param } = require('express-validator');
const db = require('../db/index');
const { authenticateToken, requireRoles } = require('../middleware/auth');
const { validateRequest, asyncHandler } = require('../middleware/common');

const router = express.Router();

router.use(authenticateToken);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { category } = req.query;
    let query = `
      SELECT p.*, 
             i.physical_quantity, 
             i.reserved_quantity,
             COALESCE(i.physical_quantity, 0) - COALESCE(i.reserved_quantity, 0) as available_quantity,
             i.id as inventory_id
      FROM products p
      LEFT JOIN inventory i ON p.id = i.product_id
    `;
    const params = [];

    if (category) {
      query += ' WHERE p.category = $1';
      params.push(category);
    }
    query += ' ORDER BY p.product_code';

    const result = await db.query(query, params);
    res.json(result.rows);
  })
);

router.get(
  '/categories',
  asyncHandler(async (req, res) => {
    const result = await db.query(
      'SELECT DISTINCT category FROM products ORDER BY category'
    );
    res.json(result.rows.map(r => r.category));
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT p.*, 
              i.physical_quantity, 
              i.reserved_quantity,
              COALESCE(i.physical_quantity, 0) - COALESCE(i.reserved_quantity, 0) as available_quantity
       FROM products p
       LEFT JOIN inventory i ON p.id = i.product_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(result.rows[0]);
  })
);

router.post(
  '/',
  requireRoles('ADMIN'),
  [
    body('product_code').notEmpty().withMessage('Product code is required'),
    body('product_name').notEmpty().withMessage('Product name is required'),
    body('category').notEmpty().withMessage('Category is required'),
    body('unit').notEmpty().withMessage('Unit is required'),
    body('base_price').isFloat({ min: 0 }).withMessage('Base price must be >= 0'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { product_code, product_name, category, unit, base_price, physical_quantity } = req.body;

      const productResult = await client.query(
        `INSERT INTO products (product_code, product_name, category, unit, base_price)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [product_code, product_name, category, unit, base_price]
      );

      await client.query(
        `INSERT INTO inventory (product_id, physical_quantity, reserved_quantity)
         VALUES ($1, $2, 0)`,
        [productResult.rows[0].id, physical_quantity || 0]
      );

      await client.query('COMMIT');
      res.status(201).json(productResult.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

router.put(
  '/:id/inventory',
  requireRoles('ADMIN'),
  [
    param('id').isUUID(),
    body('physical_quantity').optional().isInt({ min: 0 }).withMessage('Physical quantity must be >= 0'),
    body('reserved_quantity').optional().isInt({ min: 0 }).withMessage('Reserved quantity must be >= 0'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { physical_quantity, reserved_quantity } = req.body;

    if (physical_quantity !== undefined && reserved_quantity !== undefined && reserved_quantity > physical_quantity) {
      return res.status(400).json({ error: 'Reserved quantity cannot exceed physical quantity' });
    }

    const result = await db.query(
      `INSERT INTO inventory (product_id, physical_quantity, reserved_quantity)
       VALUES ($1, 
               COALESCE($2, 0), 
               COALESCE($3, 0))
       ON CONFLICT (product_id) DO UPDATE SET
         physical_quantity = COALESCE($2, inventory.physical_quantity),
         reserved_quantity = COALESCE($3, inventory.reserved_quantity),
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [id, physical_quantity, reserved_quantity]
    );

    res.json(result.rows[0]);
  })
);

module.exports = router;
