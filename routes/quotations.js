const express = require('express');
const { body, param } = require('express-validator');
const db = require('../db/index');
const { authenticateToken, requireRoles } = require('../middleware/auth');
const { validateRequest, asyncHandler, generateSequentialNumber } = require('../middleware/common');

const router = express.Router();

function calculateLineAmount(quantity, unit_price, discount_percent, gst_percent) {
  const base = quantity * unit_price;
  const discounted = base * (1 - (discount_percent || 0) / 100);
  const withGst = discounted * (1 + (gst_percent || 0) / 100);
  return parseFloat(withGst.toFixed(2));
}

router.use(authenticateToken);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT q.*, 
              e.enquiry_number, e.enquiry_date, e.required_date,
              c.company_name, c.contact_person, c.mobile, c.email, c.city,
              u.full_name as created_by_name
       FROM quotations q
       JOIN enquiries e ON q.enquiry_id = e.id
       JOIN customers c ON q.customer_id = c.id
       JOIN users u ON q.created_by = u.id
       ORDER BY q.created_at DESC`
    );

    const quotations = result.rows;
    for (const q of quotations) {
      const items = await db.query(
        `SELECT qi.*, p.product_code, p.product_name, p.unit
         FROM quotation_items qi
         JOIN products p ON qi.product_id = p.id
         WHERE qi.quotation_id = $1`,
        [q.id]
      );
      q.items = items.rows;
    }

    res.json(quotations);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT q.*, 
              e.enquiry_number, e.enquiry_date, e.required_date, e.notes as enquiry_notes, e.status as enquiry_status,
              c.company_name, c.contact_person, c.mobile, c.email, c.city,
              u.full_name as created_by_name
       FROM quotations q
       JOIN enquiries e ON q.enquiry_id = e.id
       JOIN customers c ON q.customer_id = c.id
       JOIN users u ON q.created_by = u.id
       WHERE q.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quotation not found' });
    }

    const quotation = result.rows[0];
    const items = await db.query(
      `SELECT qi.*, p.product_code, p.product_name, p.unit
       FROM quotation_items qi
       JOIN products p ON qi.product_id = p.id
       WHERE qi.quotation_id = $1`,
      [quotation.id]
    );
    quotation.items = items.rows;

    res.json(quotation);
  })
);

router.post(
  '/',
  requireRoles('SALES', 'ADMIN'),
  [
    body('enquiry_id').isUUID().withMessage('Valid enquiry ID required'),
    body('valid_until').optional(),
    body('items').isArray({ min: 1 }).withMessage('At least one item required'),
    body('items.*.product_id').isUUID(),
    body('items.*.quantity').isInt({ min: 1 }),
    body('items.*.unit_price').isFloat({ min: 0 }),
    body('items.*.discount_percent').optional().isFloat({ min: 0, max: 100 }),
    body('items.*.gst_percent').optional().isFloat({ min: 0, max: 100 }),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const { enquiry_id, valid_until, items } = req.body;

      const enquiryCheck = await client.query(
        'SELECT e.*, c.id as customer_id FROM enquiries e JOIN customers c ON e.customer_id = c.id WHERE e.id = $1',
        [enquiry_id]
      );
      if (enquiryCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Enquiry not found' });
      }
      const enquiry = enquiryCheck.rows[0];

      let grandTotal = 0;
      const calculatedItems = items.map(item => {
        const lineAmount = calculateLineAmount(
          item.quantity,
          item.unit_price,
          item.discount_percent || 0,
          item.gst_percent || 0
        );
        grandTotal += lineAmount;
        return { ...item, line_amount: lineAmount };
      });
      grandTotal = parseFloat(grandTotal.toFixed(2));

      const quotation_number = generateSequentialNumber('QUO');

      const quoteResult = await client.query(
        `INSERT INTO quotations 
         (quotation_number, enquiry_id, customer_id, valid_until, grand_total, status, created_by)
         VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6)
         RETURNING *`,
        [quotation_number, enquiry_id, enquiry.customer_id, valid_until || null, grandTotal, req.user.id]
      );

      const quotation = quoteResult.rows[0];

      for (const item of calculatedItems) {
        await client.query(
          `INSERT INTO quotation_items 
           (quotation_id, product_id, quantity, unit_price, discount_percent, gst_percent, line_amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            quotation.id,
            item.product_id,
            item.quantity,
            item.unit_price,
            item.discount_percent || 0,
            item.gst_percent || 0,
            item.line_amount,
          ]
        );
      }

      await client.query(
        `UPDATE enquiries SET status = 'QUOTED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [enquiry_id]
      );

      await client.query('COMMIT');

      const fullQuote = await db.query(
        `SELECT q.*, c.company_name, e.enquiry_number
         FROM quotations q
         JOIN customers c ON q.customer_id = c.id
         JOIN enquiries e ON q.enquiry_id = e.id
         WHERE q.id = $1`,
        [quotation.id]
      );
      res.status(201).json(fullQuote.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.message.includes('duplicate') || err.code === '23505') {
        return res.status(400).json({ error: 'Duplicate product in quotation items' });
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
    body('status').isIn(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED']).withMessage('Invalid status'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    const { id } = req.params;

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const currentCheck = await client.query(
        'SELECT status, enquiry_id FROM quotations WHERE id = $1',
        [id]
      );
      if (currentCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Quotation not found' });
      }
      const { enquiry_id } = currentCheck.rows[0];

      const result = await client.query(
        `UPDATE quotations SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
        [status, id]
      );

      if (status === 'ACCEPTED') {
        await client.query(
          `UPDATE enquiries SET status = 'WON', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [enquiry_id]
        );
      } else if (status === 'REJECTED') {
        await client.query(
          `UPDATE enquiries SET status = 'LOST', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [enquiry_id]
        );
      }

      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

router.post(
  '/:id/convert',
  requireRoles('SALES', 'ADMIN'),
  [
    param('id').isUUID(),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      const quoteCheck = await client.query(
        'SELECT * FROM quotations WHERE id = $1',
        [id]
      );
      if (quoteCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Quotation not found' });
      }
      const quotation = quoteCheck.rows[0];

      if (quotation.status === 'DRAFT') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Cannot convert a DRAFT quotation to Sales Order' });
      }
      if (quotation.status === 'REJECTED') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Cannot convert a REJECTED quotation to Sales Order' });
      }
      if (quotation.status !== 'ACCEPTED') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Only ACCEPTED quotations can be converted to Sales Orders' });
      }

      const soCheck = await client.query(
        'SELECT id FROM sales_orders WHERE quotation_id = $1',
        [id]
      );
      if (soCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'A Sales Order already exists for this quotation' });
      }

      const quoteItems = await client.query(
        `SELECT qi.*, p.product_name FROM quotation_items qi
         JOIN products p ON qi.product_id = p.id
         WHERE qi.quotation_id = $1`,
        [id]
      );

      const order_number = generateSequentialNumber('SO');
      const today = new Date().toISOString().split('T')[0];

      const soResult = await client.query(
        `INSERT INTO sales_orders
         (order_number, quotation_id, customer_id, order_date, total_amount, status, created_by)
         VALUES ($1, $2, $3, $4, $5, 'PENDING', $6)
         RETURNING *`,
        [order_number, id, quotation.customer_id, today, quotation.grand_total, req.user.id]
      );

      const salesOrder = soResult.rows[0];

      for (const item of quoteItems.rows) {
        await client.query(
          `INSERT INTO sales_order_items (sales_order_id, product_id, quantity, unit_price)
           VALUES ($1, $2, $3, $4)`,
          [salesOrder.id, item.product_id, item.quantity, item.unit_price]
        );
      }

      await client.query('COMMIT');

      const fullSO = await db.query(
        `SELECT so.*, c.company_name, q.quotation_number
         FROM sales_orders so
         JOIN customers c ON so.customer_id = c.id
         JOIN quotations q ON so.quotation_id = q.id
         WHERE so.id = $1`,
        [salesOrder.id]
      );
      res.status(201).json(fullSO.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

module.exports = { router, calculateLineAmount };
