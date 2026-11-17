import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authenticate';
import { query } from '@/config/database';
import { getMenuOtpEmail, isMenuTokenValid } from '@/modules/menuAccess/menuAccess.service';

type Kind = 'payment-delete' | 'payment-edit' | 'order-delete' | 'order-edit';

/**
 * Protects the restaurant's records. When the restaurant has a security email set, these need an
 * OTP emailed to that address (verified token sent in `x-records-token`):
 *   - deleting a payment or an order (always)
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
      if (isMenuTokenValid(req.header('x-records-token') || undefined, userId, restaurantId, 'records')) return next();
      res.status(403).json({ success: false, error: { code: 'RECORDS_OTP_REQUIRED', message: 'Enter the OTP sent to the admin email to change recorded orders or payments.' } });
    } catch (err) {
      next(err);
    }
  };
