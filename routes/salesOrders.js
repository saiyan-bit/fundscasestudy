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
      `SELECT so.*, 
              c.company_name, c.contact_person, c.mobile, c.email, c.city,
              q.quotation_number, q.status as quotation_status,
              u.full_name as created_by_name,
              uc.full_name as confirmed_by_name
       FROM sales_orders so
       JOIN customers c ON so.customer_id = c.id
       JOIN quotations q ON so.quotation_id = q.id
       JOIN users u ON so.created_by = u.id
       LEFT JOIN users uc ON so.confirmed_by = uc.id
       ORDER BY so.created_at DESC`
    );

    const orders = result.rows;
    for (const so of orders) {
      const items = await db.query(
        `SELECT soi.*, 
                p.product_code, p.product_name, p.unit,
                i.physical_quantity,
                i.reserved_quantity,
                COALESCE(i.physical_quantity, 0) - COALESCE(i.reserved_quantity, 0) as available_quantity
         FROM sales_order_items soi
         JOIN products p ON soi.product_id = p.id
         LEFT JOIN inventory i ON soi.product_id = i.product_id
         WHERE soi.sales_order_id = $1`,
        [so.id]
      );
      so.items = items.rows;

      const dispatches = await db.query(
        `SELECT d.*, 
                di.product_id, di.quantity as dispatched_quantity,
                p.product_code, p.product_name
         FROM dispatches d
         JOIN dispatch_items di ON di.dispatch_id = d.id
         JOIN products p ON di.product_id = p.id
         WHERE d.sales_order_id = $1`,
        [so.id]
      );
      so.dispatches = dispatches.rows;
    }

    res.json(orders);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT so.*, 
              c.company_name, c.contact_person, c.mobile, c.email, c.city,
              q.quotation_number, q.status as quotation_status, q.valid_until,
              u.full_name as created_by_name,
              uc.full_name as confirmed_by_name
       FROM sales_orders so
       JOIN customers c ON so.customer_id = c.id
       JOIN quotations q ON so.quotation_id = q.id
       JOIN users u ON so.created_by = u.id
       LEFT JOIN users uc ON so.confirmed_by = uc.id
       WHERE so.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sales Order not found' });
    }

    const so = result.rows[0];
    const items = await db.query(
      `SELECT soi.*, 
              p.product_code, p.product_name, p.unit,
              i.physical_quantity,
              i.reserved_quantity,
              COALESCE(i.physical_quantity, 0) - COALESCE(i.reserved_quantity, 0) as available_quantity
       FROM sales_order_items soi
       JOIN products p ON soi.product_id = p.id
       LEFT JOIN inventory i ON soi.product_id = i.product_id
       WHERE soi.sales_order_id = $1`,
      [so.id]
    );
    so.items = items.rows;

    const dispatches = await db.query(
      `SELECT d.*
       FROM dispatches d
       WHERE d.sales_order_id = $1`,
      [so.id]
    );
    so.dispatches = dispatches.rows;

    for (const dispatch of so.dispatches) {
      const dItems = await db.query(
        `SELECT di.*, p.product_code, p.product_name
         FROM dispatch_items di
         JOIN products p ON di.product_id = p.id
         WHERE di.dispatch_id = $1`,
        [dispatch.id]
      );
      dispatch.items = dItems.rows;
    }

    res.json(so);
  })
);

router.post(
  '/:id/confirm',
  requireRoles('ADMIN'),
  [param('id').isUUID()],
  validateRequest,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      const soCheck = await client.query('SELECT * FROM sales_orders WHERE id = $1 FOR UPDATE', [id]);
      if (soCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Sales Order not found' });
      }
      const so = soCheck.rows[0];

      if (so.status === 'CANCELLED') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Cannot confirm a cancelled order' });
      }
      if (so.status === 'DISPATCHED') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Order is already dispatched' });
      }
      if (so.status === 'CONFIRMED') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Order is already confirmed' });
      }

      const soItems = await client.query(
        'SELECT * FROM sales_order_items WHERE sales_order_id = $1',
        [id]
      );

      const reservations = [];
      for (const item of soItems.rows) {
        const inv = await client.query(
          'SELECT * FROM inventory WHERE product_id = $1 FOR UPDATE',
          [item.product_id]
        );

        if (inv.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: `No inventory record for product ${item.product_id}`,
          });
        }

        const inventory = inv.rows[0];
        const available = (inventory.physical_quantity || 0) - (inventory.reserved_quantity || 0);

        if (available < item.quantity) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: `Insufficient inventory for product. Available: ${available}, Required: ${item.quantity}`,
            product_id: item.product_id,
            available,
            required: item.quantity,
          });
        }

        reservations.push({
          product_id: item.product_id,
          new_reserved: inventory.reserved_quantity + item.quantity,
          version: inventory.version,
        });
      }

      for (const res of reservations) {
        const updateResult = await client.query(
          `UPDATE inventory 
           SET reserved_quantity = $1, 
               version = version + 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE product_id = $2 AND version = $3
           RETURNING id`,
          [res.new_reserved, res.product_id, res.version]
        );

        if (updateResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: 'Inventory changed during confirmation due to concurrent reservation. Please try again.',
          });
        }
      }

      const updateResult = await client.query(
        `UPDATE sales_orders 
         SET status = 'CONFIRMED', 
             confirmed_at = CURRENT_TIMESTAMP, 
             confirmed_by = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`,
        [req.user.id, id]
      );

      await client.query('COMMIT');
      res.json(updateResult.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

router.post(
  '/:id/cancel',
  requireRoles('ADMIN'),
  [param('id').isUUID()],
  validateRequest,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      const soCheck = await client.query('SELECT * FROM sales_orders WHERE id = $1 FOR UPDATE', [id]);
      if (soCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Sales Order not found' });
      }
      const so = soCheck.rows[0];

      if (so.status === 'CANCELLED') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Order is already cancelled' });
      }
      if (so.status === 'DISPATCHED') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Cannot cancel a dispatched order' });
      }

      const soItems = await client.query(
        'SELECT * FROM sales_order_items WHERE sales_order_id = $1',
        [id]
      );

      if (so.status === 'CONFIRMED') {
        for (const item of soItems.rows) {
          const inv = await client.query(
            'SELECT * FROM inventory WHERE product_id = $1 FOR UPDATE',
            [item.product_id]
          );

          if (inv.rows.length > 0) {
            const inventory = inv.rows[0];
            const newReserved = Math.max(0, inventory.reserved_quantity - item.quantity);
            await client.query(
              `UPDATE inventory SET reserved_quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE product_id = $2`,
              [newReserved, item.product_id]
            );
          }
        }
      }

      const updateResult = await client.query(
        `UPDATE sales_orders 
         SET status = 'CANCELLED',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [id]
      );

      await client.query('COMMIT');
      res.json(updateResult.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

router.post(
  '/:id/dispatch',
  requireRoles('ADMIN'),
  [
    param('id').isUUID(),
    body('dispatch_date').notEmpty().withMessage('Dispatch date is required'),
    body('vehicle_number').optional(),
    body('driver_name').optional(),
    body('items').isArray({ min: 1 }).withMessage('At least one dispatch item required'),
    body('items.*.sales_order_item_id').isUUID(),
    body('items.*.product_id').isUUID(),
    body('items.*.quantity').isInt({ min: 1 }),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { dispatch_date, vehicle_number, driver_name, items } = req.body;
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      const soCheck = await client.query('SELECT * FROM sales_orders WHERE id = $1 FOR UPDATE', [id]);
      if (soCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Sales Order not found' });
      }
      const so = soCheck.rows[0];

      if (so.status === 'CANCELLED') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Cannot dispatch a cancelled order' });
      }
      if (so.status === 'PENDING') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Order must be confirmed before dispatching' });
      }

      const soItems = await client.query(
        'SELECT * FROM sales_order_items WHERE sales_order_id = $1',
        [id]
      );
      const soItemMap = new Map(soItems.rows.map(i => [i.id, i]));

      const existingDispatches = await client.query(
        `SELECT di.sales_order_item_id, SUM(di.quantity) as total_dispatched
         FROM dispatches d
         JOIN dispatch_items di ON d.id = di.dispatch_id
         WHERE d.sales_order_id = $1
         GROUP BY di.sales_order_item_id`,
        [id]
      );
      const dispatchedMap = new Map(existingDispatches.rows.map(r => [r.sales_order_item_id, parseInt(r.total_dispatched)]));

      for (const item of items) {
        const soi = soItemMap.get(item.sales_order_item_id);
        if (!soi) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Invalid sales order item: ${item.sales_order_item_id}` });
        }
        if (soi.product_id !== item.product_id) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Product mismatch with sales order item' });
        }

        const alreadyDispatched = dispatchedMap.get(item.sales_order_item_id) || 0;
        const remaining = soi.quantity - alreadyDispatched;
        if (item.quantity > remaining) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: `Cannot dispatch more than remaining quantity. Remaining: ${remaining}, Attempted: ${item.quantity}`,
          });
        }

        const inv = await client.query(
          'SELECT * FROM inventory WHERE product_id = $1 FOR UPDATE',
          [item.product_id]
        );
        if (inv.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Inventory not found for product` });
        }

        const inventory = inv.rows[0];
        if (item.quantity > inventory.reserved_quantity) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: `Cannot dispatch more than reserved quantity. Reserved: ${inventory.reserved_quantity}, Attempted: ${item.quantity}`,
          });
        }
      }

      const dispatch_number = generateSequentialNumber('DSP');

      const dispatchResult = await client.query(
        `INSERT INTO dispatches 
         (dispatch_number, sales_order_id, dispatch_date, vehicle_number, driver_name, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [dispatch_number, id, dispatch_date, vehicle_number || null, driver_name || null, req.user.id]
      );
      const dispatch = dispatchResult.rows[0];

      for (const item of items) {
        await client.query(
          `INSERT INTO dispatch_items 
           (dispatch_id, sales_order_item_id, product_id, quantity)
           VALUES ($1, $2, $3, $4)`,
          [dispatch.id, item.sales_order_item_id, item.product_id, item.quantity]
        );

        await client.query(
          `UPDATE inventory 
           SET physical_quantity = physical_quantity - $1,
               reserved_quantity = reserved_quantity - $1,
               version = version + 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE product_id = $2`,
          [item.quantity, item.product_id]
        );

        const prevDispatched = dispatchedMap.get(item.sales_order_item_id) || 0;
        const soi = soItemMap.get(item.sales_order_item_id);
        if (prevDispatched + item.quantity >= soi.quantity) {
          dispatchedMap.set(item.sales_order_item_id, soi.quantity);
        } else {
          dispatchedMap.set(item.sales_order_item_id, prevDispatched + item.quantity);
        }
      }

      const allFullyDispatched = soItems.rows.every(soi => {
        const dispatched = dispatchedMap.get(soi.id) || 0;
        return dispatched >= soi.quantity;
      });

      if (allFullyDispatched) {
        await client.query(
          `UPDATE sales_orders SET status = 'DISPATCHED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [id]
        );
      }

      await client.query('COMMIT');
      res.status(201).json(dispatch);
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.message && err.message.includes('check constraint')) {
        return res.status(400).json({ error: 'Inventory constraint violation: negative quantities prevented' });
      }
      throw err;
    } finally {
      client.release();
    }
  })
);

module.exports = router;
