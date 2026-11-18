import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authenticate';
import { query } from '@/config/database';
import { getMenuOtpEmail, isMenuTokenValid, isTokenFresh, FRESH_CODE_SECONDS } from '@/modules/menuAccess/menuAccess.service';

type Kind = 'payment-delete' | 'payment-edit' | 'order-delete' | 'order-edit';

/**
 * Protects the restaurant's records. When the restaurant has a security email set, these need an
 * OTP emailed to that address (verified token sent in `x-records-token`):
 *   - deleting a payment or an order (always, and every delete needs a FRESH code — one entered in the last few minutes)
 *   - editing a payment that is already PAID / REFUNDED
 *   - editing an order that is already COMPLETED / CANCELLED
 * Normal day-to-day flow (taking a payment, moving an open order along, cancelling an open order) is untouched.
 */
export const requireRecordsOtp = (kind: Kind) =>
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) return next();
      const { restaurantId, userId, role } = req.user;

      let isRecorded = kind === 'payment-delete' || kind === 'order-delete';
      if (!isRecorded) {
        const table = kind === 'payment-edit' ? 'payments' : 'orders';
        const r = await query(`SELECT status FROM ${table} WHERE id = $1 AND restaurant_id = $2`, [req.params.id, restaurantId]);
        const status = r.rows[0]?.status;
        // The payment screen re-sends "status: COMPLETED" after paying, but the server has already completed
        // the order. Repeating the status it already has changes nothing, so it must not ask for a code.
        if (kind === 'order-edit') {
          const keys = Object.keys(req.body || {});
          if (keys.length === 1 && keys[0] === 'status' && req.body.status === status) return next();
        }
        isRecorded = kind === 'payment-edit'
          ? status === 'PAID' || status === 'REFUNDED'
          : status === 'COMPLETED' || status === 'CANCELLED';
      }
      if (!isRecorded) return next();

      const email = await getMenuOtpEmail(restaurantId);
      if (!email) return next();

      if (role !== 'ADMIN') {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Only the admin can change recorded orders and payments.' } });
        return;
      }
      const token = req.header('x-records-token') || undefined;
      const isDelete = kind === 'payment-delete' || kind === 'order-delete';
      const ok = isDelete
        ? isTokenFresh(token, userId, restaurantId, 'records', FRESH_CODE_SECONDS)
        : isMenuTokenValid(token, userId, restaurantId, 'records');
      if (ok) return next();
      res.status(403).json({ success: false, error: { code: 'RECORDS_OTP_REQUIRED', message: 'Enter the OTP sent to the admin email to change recorded orders or payments.' } });
    } catch (err) {
      next(err);
    }
  };
