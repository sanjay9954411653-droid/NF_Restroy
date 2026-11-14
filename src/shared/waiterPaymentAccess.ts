import { query } from '@/config/database';
import { ForbiddenError } from '@/shared/errors/AppError';

/**
 * Admin can switch off "waiters collect payment" (restaurants.waiter_can_collect_payment).
 * Call this wherever money is taken or an order is closed as paid. Only WAITER users are
 * affected — admin and reception always can. Throws 403 when the waiter is not allowed.
 */
export async function assertCanCollectPayment(
  user: { role?: string; restaurantId?: string } | undefined,
): Promise<void> {
  if (!user || user.role !== 'WAITER' || !user.restaurantId) return;
  const r = await query(
    'SELECT waiter_can_collect_payment FROM restaurants WHERE id = $1',
    [user.restaurantId],
  );
  if (r.rows[0] && r.rows[0].waiter_can_collect_payment === false) {
    throw new ForbiddenError('Payment collection is turned off for waiters. Please ask the cashier.');
  }
}
