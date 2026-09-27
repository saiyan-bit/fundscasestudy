const express = require('express');
const bcrypt = require('bcryptjs');
const { body } = require('express-validator');
const db = require('../db/index');
const { generateToken, authenticateToken } = require('../middleware/auth');
const { validateRequest, asyncHandler } = require('../middleware/common');

const router = express.Router();

router.post(
  '/login',
  [
    body('username').notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;

    const result = await db.query(
      'SELECT id, username, email, password_hash, role, full_name FROM users WHERE username = $1 OR email = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        fullName: user.full_name,
      },
    });
  })
);

router.get(
  '/me',
  authenticateToken,
  asyncHandler(async (req, res) => {
    res.json({
      user: {
        id: req.user.id,
        username: req.user.username,
        email: req.user.email,
        role: req.user.role,
        fullName: req.user.fullName,
      },
    });
  })
);

module.exports = router;
