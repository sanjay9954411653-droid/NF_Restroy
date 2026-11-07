import { query } from '@/config/database';
import { ForbiddenError, NotFoundError } from '@/shared/errors/AppError';

interface StaffUser {
  userId: string;
  role: string;
  restaurantId: string;
}

export interface WaiterAccess {
  tableIds: string[];
  pickup: boolean; // may take / see pick-up (no table) orders
}

/**
 * What a waiter may see / order for.
 * Returns null when there is no restriction (non-waiters, or waiters with nothing assigned).
 */
export async function getWaiterAccess(user?: StaffUser): Promise<WaiterAccess | null> {
  if (!user || user.role !== 'WAITER') return null;
  const [tables, flag] = await Promise.all([
    query(
      `SELECT wt.table_id FROM waiter_tables wt
       JOIN restaurant_tables t ON t.id = wt.table_id
       WHERE wt.user_id = $1 AND t.restaurant_id = $2`,
      [user.userId, user.restaurantId],
    ),
    query('SELECT pickup_assigned FROM users WHERE id = $1', [user.userId]),
  ]);
  const tableIds = tables.rows.map((r: any) => r.table_id as string);
  const pickup = Boolean(flag.rows[0]?.pickup_assigned);
  if (tableIds.length === 0 && !pickup) return null;
  return { tableIds, pickup };
}

/** Throws unless the user may act on this table. A null tableId means a pick-up order. */
export async function assertTableAccess(user: StaffUser | undefined, tableId: string | null | undefined): Promise<void> {
  const access = await getWaiterAccess(user);
  if (access === null) return;
  if (!tableId) {
    if (!access.pickup) throw new ForbiddenError('You are not assigned to pick-up orders');
    return;
  }
  if (!access.tableIds.includes(tableId)) {
    throw new ForbiddenError('You are not assigned to this table');
  }
}

/** Throws unless the user may act on this order's table (or pick-up). */
export async function assertOrderAccess(user: StaffUser | undefined, orderId: string): Promise<void> {
  const access = await getWaiterAccess(user);
  if (access === null) return;
  const result = await query('SELECT table_id, order_type FROM orders WHERE id = $1 AND restaurant_id = $2', [orderId, user!.restaurantId]);
  if (!result.rows[0]) throw new NotFoundError('Order not found');
  const { table_id: tableId, order_type: orderType } = result.rows[0] as { table_id: string | null; order_type: string };
  if (tableId) {
    if (!access.tableIds.includes(tableId)) throw new ForbiddenError('This order is not on one of your assigned tables');
  } else if (!(access.pickup && orderType === 'PARCEL')) {
    throw new ForbiddenError('You are not assigned to pick-up orders');
  }
}

export async function getAssignedTableIds(userId: string): Promise<string[]> {
  const result = await query('SELECT table_id FROM waiter_tables WHERE user_id = $1', [userId]);
  return result.rows.map((r: any) => r.table_id as string);
}

export async function getPickupAssigned(userId: string): Promise<boolean> {
  const result = await query('SELECT pickup_assigned FROM users WHERE id = $1', [userId]);
  return Boolean(result.rows[0]?.pickup_assigned);
}

/** Replace a user's table + pick-up assignments (only tables of the given restaurant are kept). */
export async function setAssignedAccess(
  userId: string,
  restaurantId: string,
  tableIds: string[],
  pickup: boolean,
): Promise<{ tableIds: string[]; pickup: boolean }> {
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
  await query('UPDATE users SET pickup_assigned = $2 WHERE id = $1 AND restaurant_id = $3', [userId, pickup, restaurantId]);
  return { tableIds: valid, pickup };
}
