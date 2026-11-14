import { Router } from 'express';
import { paymentsController } from './payments.controller';
import { authenticate } from '@/shared/middleware/authenticate';
import { authorize } from '@/shared/middleware/authorize';
import { checkSubscription } from '@/shared/middleware/checkSubscription';
import { AuthenticatedRequest } from '@/shared/middleware/authenticate';
import { pool } from '@/config/database';
import { successResponse } from '@/shared/utils/responseHandler';
import { NotFoundError } from '@/shared/errors/AppError';
import { getOrderPayableTotal } from '@/shared/billing';

const router = Router();

router.post('/', authenticate, checkSubscription, (req, res, next) => paymentsController.create(req, res, next));
router.get('/', authenticate, (req, res, next) => paymentsController.list(req, res, next));
router.get('/summary', authenticate, (req, res, next) => paymentsController.summary(req, res, next));
router.get('/stats', authenticate, authorize('ADMIN'), (req, res, next) => paymentsController.getStats(req, res, next));
// What is left to collect on an order: bill grand total (GST + charges - coupon) minus PAID so far.
router.get('/order/:orderId/balance', authenticate, async (req: AuthenticatedRequest, res, next) => {
  try {
    const restaurantId = req.user!.restaurantId;
    const o = await pool.query(
      `SELECT id, total_amount FROM orders WHERE id = $1 AND restaurant_id = $2`,
      [req.params.orderId, restaurantId],
    );
    if (o.rows.length === 0) throw new NotFoundError('Order not found');
    const total = await getOrderPayableTotal(
      (t, p) => pool.query(t, p),
      restaurantId,
      Number(o.rows[0].total_amount || 0),
      String(req.params.orderId),
    );
    const paidRes = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE order_id = $1 AND status = 'PAID'`,
      [req.params.orderId],
    );
    const paid = Number(paidRes.rows[0].paid);
    const balance = Math.max(0, Math.round((total - paid) * 100) / 100);
    res.json(successResponse({ total, paid, balance }));
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, (req, res, next) => paymentsController.getById(req, res, next));
router.put('/:id', authenticate, authorize('ADMIN'), checkSubscription, (req, res, next) => paymentsController.update(req, res, next));
router.patch('/:id', authenticate, authorize('ADMIN'), checkSubscription, (req, res, next) => paymentsController.update(req, res, next));
router.delete('/:id', authenticate, authorize('ADMIN'), checkSubscription, (req, res, next) => paymentsController.delete(req, res, next));

export default router;
