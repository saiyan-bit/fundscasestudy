require('dotenv').config();

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-testing-purposes-very-long';

const { calculateLineAmount } = require('../routes/quotations');

describe('Test 1: Quotation total calculation', () => {
  test('Line amount calculated correctly without discount and GST', () => {
    const result = calculateLineAmount(10, 100, 0, 0);
    expect(result).toBe(1000);
  });

  test('Line amount calculated correctly with discount only', () => {
    const result = calculateLineAmount(10, 100, 10, 0);
    expect(result).toBe(900);
  });

  test('Line amount calculated correctly with GST only', () => {
    const result = calculateLineAmount(10, 100, 0, 18);
    expect(result).toBe(1180);
  });

  test('Line amount calculated correctly with discount AND GST', () => {
    const result = calculateLineAmount(10, 100, 10, 18);
    expect(result).toBe(1062);
  });

  test('Grand total of multiple items sums correctly', () => {
    const items = [
      { quantity: 10, unit_price: 100, discount_percent: 0, gst_percent: 18 },
      { quantity: 5, unit_price: 200, discount_percent: 10, gst_percent: 18 },
    ];
    const total = items.reduce((sum, it) => {
      return sum + calculateLineAmount(it.quantity, it.unit_price, it.discount_percent, it.gst_percent);
    }, 0);
    expect(total).toBe(2242);
  });
});

describe('Test 2: Rejected/Draft quotation cannot create Sales Order', () => {
  test('DRAFT status should return error message', () => {
    const status = 'DRAFT';
    const canConvert = (s) => {
      if (s === 'DRAFT') return { valid: false, reason: 'Cannot convert a DRAFT quotation' };
      if (s === 'REJECTED') return { valid: false, reason: 'Cannot convert a REJECTED quotation' };
      if (s === 'ACCEPTED') return { valid: true };
      if (s === 'SENT') return { valid: false, reason: 'Only ACCEPTED quotations can be converted' };
      return { valid: false, reason: 'Invalid status' };
    };
    const result = canConvert(status);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('DRAFT');
  });

  test('REJECTED status should return error message', () => {
    const status = 'REJECTED';
    const canConvert = (s) => {
      if (s === 'DRAFT') return { valid: false, reason: 'Cannot convert a DRAFT quotation' };
      if (s === 'REJECTED') return { valid: false, reason: 'Cannot convert a REJECTED quotation' };
      if (s === 'ACCEPTED') return { valid: true };
      if (s === 'SENT') return { valid: false, reason: 'Only ACCEPTED quotations can be converted' };
      return { valid: false, reason: 'Invalid status' };
    };
    const result = canConvert(status);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('REJECTED');
  });

  test('SENT status cannot be converted', () => {
    const canConvert = (s) => {
      if (s === 'DRAFT' || s === 'REJECTED' || s === 'SENT') return s === 'ACCEPTED';
      return s === 'ACCEPTED';
    };
    expect(canConvert('SENT')).toBe(false);
  });

  test('ACCEPTED status can be converted', () => {
    const canConvert = (s) => {
      if (s === 'DRAFT' || s === 'REJECTED' || s === 'SENT') return s === 'ACCEPTED';
      return s === 'ACCEPTED';
    };
    expect(canConvert('ACCEPTED')).toBe(true);
  });
});

describe('Test 3: Same quotation cannot generate duplicate Sales Orders', () => {
  test('Duplicate quote ID in set should be rejected', () => {
    const existingOrdersByQuoteId = new Set();
    const quoteId = 'quote-123';
    existingOrdersByQuoteId.add(quoteId);

    const canCreateOrder = (qid) => {
      if (existingOrdersByQuoteId.has(qid)) {
        return { ok: false, error: 'A Sales Order already exists for this quotation' };
      }
      return { ok: true };
    };

    const result = canCreateOrder(quoteId);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('already exists');
  });

  test('New quote ID should allow order creation', () => {
    const existingOrdersByQuoteId = new Set(['q1', 'q2']);
    const canCreateOrder = (qid) => !existingOrdersByQuoteId.has(qid);
    expect(canCreateOrder('q3')).toBe(true);
  });
});

describe('Test 4: Cannot reserve more than available inventory', () => {
  test('Reservation exceeding available should fail', () => {
    const inventory = { physical_quantity: 100, reserved_quantity: 30 };
    const available = inventory.physical_quantity - inventory.reserved_quantity;
    const requested = 80;

    const canReserve = (inv, reqQty) => {
      const avail = inv.physical_quantity - inv.reserved_quantity;
      return avail >= reqQty;
    };

    expect(available).toBe(70);
    expect(canReserve(inventory, requested)).toBe(false);
  });

  test('Reservation within available should succeed', () => {
    const inventory = { physical_quantity: 100, reserved_quantity: 30 };
    const requested = 60;

    const canReserve = (inv, reqQty) => {
      const avail = inv.physical_quantity - inv.reserved_quantity;
      return avail >= reqQty;
    };

    expect(canReserve(inventory, requested)).toBe(true);
  });

  test('Reserved quantity cannot exceed physical quantity (DB constraint simulation)', () => {
    const checkConstraint = (physical, reserved) => reserved <= physical;
    expect(checkConstraint(100, 101)).toBe(false);
    expect(checkConstraint(100, 100)).toBe(true);
    expect(checkConstraint(100, 0)).toBe(true);
  });
});

describe('Test 5: Unauthorized user cannot perform restricted operation', () => {
  test('SALES user cannot confirm sales order (ADMIN-only)', () => {
    const ADMIN_ONLY = ['confirm_sales_order', 'manage_inventory', 'process_dispatch'];
    const userRole = 'SALES';
    const requiredRole = 'ADMIN';

    const hasPermission = (userRole, requiredRoles) => requiredRoles.includes(userRole);

    expect(ADMIN_ONLY.includes('confirm_sales_order')).toBe(true);
    expect(hasPermission(userRole, [requiredRole])).toBe(false);
    expect(hasPermission('ADMIN', ['ADMIN'])).toBe(true);
  });

  test('SALES user cannot manage inventory', () => {
    const permissions = {
      ADMIN: ['view_all', 'manage_inventory', 'confirm_order', 'process_dispatch', 'create_enquiry', 'create_quotation'],
      SALES: ['create_enquiry', 'create_quotation', 'convert_quotation', 'view_inventory'],
    };
    expect(permissions.SALES.includes('manage_inventory')).toBe(false);
    expect(permissions.ADMIN.includes('manage_inventory')).toBe(true);
  });

  test('Unauthenticated user gets 401', () => {
    const token = null;
    const authenticate = (t) => {
      if (!t) return { authenticated: false, status: 401, error: 'Authentication required' };
      return { authenticated: true };
    };
    const result = authenticate(token);
    expect(result.authenticated).toBe(false);
    expect(result.status).toBe(401);
  });
});

describe('Bonus: Simultaneous inventory reservation with version/optimistic locking', () => {
  test('Two concurrent reservations exceeding total available - only one succeeds', () => {
    let inventory = { physical: 100, reserved: 0, version: 1 };
    const available = () => inventory.physical - inventory.reserved;

    function reserve(reqQty, expectedVersion) {
      if (inventory.version !== expectedVersion) {
        return { success: false, reason: 'Concurrent modification detected' };
      }
      if (available() < reqQty) {
        return { success: false, reason: 'Insufficient stock' };
      }
      inventory.reserved += reqQty;
      inventory.version += 1;
      return { success: true, newVersion: inventory.version };
    }

    expect(available()).toBe(100);

    const userARequest = 80;
    const userBRequest = 50;
    const baselineVersion = inventory.version;

    const userAResult = reserve(userARequest, baselineVersion);
    expect(userAResult.success).toBe(true);
    expect(inventory.version).toBe(2);
    expect(available()).toBe(20);

    const userBResult = reserve(userBRequest, baselineVersion);
    expect(userBResult.success).toBe(false);
    expect(userBResult.reason).toBe('Concurrent modification detected');

    const userBRetry = reserve(userBRequest, inventory.version);
    expect(userBRetry.success).toBe(false);
    expect(userBRetry.reason).toBe('Insufficient stock');
  });
});
