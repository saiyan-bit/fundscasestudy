const express = require('express');
const { body, param } = require('express-validator');
const db = require('../db/index');
const { authenticateToken, requireRoles } = require('../middleware/auth');
const { validateRequest, asyncHandler, generateSequentialNumber } = require('../middleware/common');

const router = express.Router();

router.use(authenticateToken);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT e.*, c.company_name, c.contact_person, c.city, u.full_name as created_by_name
       FROM enquiries e
       JOIN customers c ON e.customer_id = c.id
       JOIN users u ON e.created_by = u.id
       ORDER BY e.created_at DESC`
    );

    const enquiries = result.rows;
    for (const enquiry of enquiries) {
      const items = await db.query(
        `SELECT ei.*, p.product_code, p.product_name, p.unit, p.base_price
         FROM enquiry_items ei
         JOIN products p ON ei.product_id = p.id
         WHERE ei.enquiry_id = $1`,
        [enquiry.id]
      );
      enquiry.items = items.rows;
    }

    res.json(enquiries);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT e.*, c.company_name, c.contact_person, c.mobile, c.email, c.city, u.full_name as created_by_name
       FROM enquiries e
       JOIN customers c ON e.customer_id = c.id
       JOIN users u ON e.created_by = u.id
       WHERE e.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Enquiry not found' });
    }

    const enquiry = result.rows[0];
    const items = await db.query(
      `SELECT ei.*, p.product_code, p.product_name, p.unit, p.base_price
       FROM enquiry_items ei
       JOIN products p ON ei.product_id = p.id
       WHERE ei.enquiry_id = $1`,
      [enquiry.id]
    );
    enquiry.items = items.rows;

    res.json(enquiry);
  })
);

router.post(
  '/',
  requireRoles('SALES', 'ADMIN'),
  [
    body('customer_id').isUUID().withMessage('Valid customer ID is required'),
    body('enquiry_date').notEmpty().withMessage('Enquiry date is required'),
    body('required_date').optional(),
    body('notes').optional(),
    body('items').isArray({ min: 1 }).withMessage('At least one product is required'),
    body('items.*.product_id').isUUID().withMessage('Valid product ID required'),
    body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const { customer_id, enquiry_date, required_date, notes, items } = req.body;

      const customerCheck = await client.query('SELECT id FROM customers WHERE id = $1', [customer_id]);
      if (customerCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Invalid customer' });
      }

      const enquiry_number = generateSequentialNumber('ENQ');

      const enquiryResult = await client.query(
        `INSERT INTO enquiries 
         (enquiry_number, customer_id, enquiry_date, required_date, notes, status, created_by)
         VALUES ($1, $2, $3, $4, $5, 'NEW', $6)
         RETURNING *`,
        [enquiry_number, customer_id, enquiry_date, required_date || null, notes || null, req.user.id]
      );

      const enquiry = enquiryResult.rows[0];

      for (const item of items) {
        await client.query(
          `INSERT INTO enquiry_items (enquiry_id, product_id, quantity)
           VALUES ($1, $2, $3)`,
          [enquiry.id, item.product_id, item.quantity]
        );
      }

      await client.query('COMMIT');

      const fullEnquiry = await db.query(
        `SELECT e.*, c.company_name, c.contact_person
         FROM enquiries e
         JOIN customers c ON e.customer_id = c.id
         WHERE e.id = $1`,
        [enquiry.id]
      );
      res.status(201).json(fullEnquiry.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.message.includes('duplicate') || err.code === '23505') {
        return res.status(400).json({ error: 'Duplicate product in enquiry items' });
      }
      throw err;
    } finally {
      client.release();
    }
  })
);

router.patch(
  '/:id/status',
  requireRoles('SALES', 'ADMIN'),
  [
    param('id').isUUID(),
    body('status').isIn(['NEW', 'QUOTED', 'WON', 'LOST']).withMessage('Invalid status'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    const result = await db.query(
      `UPDATE enquiries SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Enquiry not found' });
    }

    res.json(result.rows[0]);
  })
);

module.exports = router;
