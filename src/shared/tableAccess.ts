import { query } from '@/config/database';
import { ForbiddenError, NotFoundError } from '@/shared/errors/AppError';

interface StaffUser {
  userId: string;
  role: string;
  restaurantId: string;
}

/**
 * Tables a waiter may see / order for.
 * Returns null when there is no restriction (non-waiters, or waiters with no tables assigned).
 */
export async function getAllowedTableIds(user?: StaffUser): Promise<string[] | null> {
  if (!user || user.role !== 'WAITER') return null;
  const result = await query(
    `SELECT wt.table_id FROM waiter_tables wt
     JOIN restaurant_tables t ON t.id = wt.table_id
     WHERE wt.user_id = $1 AND t.restaurant_id = $2`,
    [user.userId, user.restaurantId],
  );
  if (result.rows.length === 0) return null;
  return result.rows.map((r: any) => r.table_id as string);
}

/** Throws unless the user may act on this table. A null tableId (takeaway etc.) is blocked for restricted waiters. */
export async function assertTableAccess(user: StaffUser | undefined, tableId: string | null | undefined): Promise<void> {
  const allowed = await getAllowedTableIds(user);
  if (allowed === null) return;
  if (!tableId || !allowed.includes(tableId)) {
    throw new ForbiddenError('You are not assigned to this table');
  }
}

/** Throws unless the user may act on the table this order belongs to. */
export async function assertOrderAccess(user: StaffUser | undefined, orderId: string): Promise<void> {
  const allowed = await getAllowedTableIds(user);
  if (allowed === null) return;
  const result = await query('SELECT table_id FROM orders WHERE id = $1 AND restaurant_id = $2', [orderId, user!.restaurantId]);
  if (!result.rows[0]) throw new NotFoundError('Order not found');
  const tableId = result.rows[0].table_id as string | null;
  if (!tableId || !allowed.includes(tableId)) {
    throw new ForbiddenError('This order is not on one of your assigned tables');
  }
}

export async function getAssignedTableIds(userId: string): Promise<string[]> {
  const result = await query('SELECT table_id FROM waiter_tables WHERE user_id = $1', [userId]);
  return result.rows.map((r: any) => r.table_id as string);
}

/** Replace a user's table assignments (only tables of the given restaurant are kept). */
export async function setAssignedTableIds(userId: string, restaurantId: string, tableIds: string[]): Promise<string[]> {
  const valid = tableIds.length
    ? (await query(
        'SELECT id FROM restaurant_tables WHERE restaurant_id = $1 AND id = ANY($2::uuid[])',
        [restaurantId, tableIds],
      )).rows.map((r: any) => r.id as string)
    : [];
  await query('DELETE FROM waiter_tables WHERE user_id = $1', [userId]);
  for (const id of valid) {
    await query('INSERT INTO waiter_tables (user_id, table_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, id]);
  }
  return valid;
}
