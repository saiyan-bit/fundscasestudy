const express = require('express');
const { body, query } = require('express-validator');
const db = require('../db/index');
const { authenticateToken, requireRoles } = require('../middleware/auth');
const { validateRequest, asyncHandler } = require('../middleware/common');

const router = express.Router();

router.use(authenticateToken);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { search } = req.query;
    let query = 'SELECT * FROM customers';
    const params = [];

    if (search) {
      query += ` WHERE company_name ILIKE $1 OR contact_person ILIKE $1 OR city ILIKE $1`;
      params.push(`%${search}%`);
    }

    query += ' ORDER BY created_at DESC';
    const result = await db.query(query, params);
    res.json(result.rows);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await db.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json(result.rows[0]);
  })
);

router.post(
  '/',
  requireRoles('SALES', 'ADMIN'),
  [
    body('company_name').notEmpty().withMessage('Company name is required'),
    body('contact_person').notEmpty().withMessage('Contact person is required'),
    body('mobile').notEmpty().withMessage('Mobile number is required'),
    body('email').optional().isEmail().withMessage('Invalid email format'),
    body('city').optional(),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const { company_name, contact_person, mobile, email, city } = req.body;

    const result = await db.query(
      `INSERT INTO customers (company_name, contact_person, mobile, email, city)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [company_name, contact_person, mobile, email || null, city || null]
    );

    res.status(201).json(result.rows[0]);
  })
);

module.exports = router;
