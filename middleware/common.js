const { validationResult } = require('express-validator');

function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      errors: errors.array().map(e => ({
        field: e.param,
        message: e.msg,
      })),
    });
  }
  next();
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function generateSequentialNumber(prefix) {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `${prefix}-${year}${month}${day}-${rand}`;
}

module.exports = {
  validateRequest,
  asyncHandler,
  generateSequentialNumber,
};
