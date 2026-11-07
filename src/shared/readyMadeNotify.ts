import { eventBroadcaster } from '@/shared/socket/eventBroadcaster';
import { pushService } from '@/modules/push/push.service';
import { ordersRepository } from '@/modules/orders/orders.repository';
import { query } from '@/config/database';

/**
 * SQL fragment: the order status to move a just-confirmed (paid) QR order to.
 * Orders with nothing for the kitchen to cook (every line is ready-made) go
 * straight to READY; everything else goes to ACCEPTED as before.
 * Use inside `UPDATE orders SET status = ${NEXT_STATUS_AFTER_CONFIRM_SQL} ...`.
 */
export const NEXT_STATUS_AFTER_CONFIRM_SQL = `CASE WHEN EXISTS (
    SELECT 1 FROM order_items oi WHERE oi.order_id = orders.id AND oi.status <> 'CANCELLED'
  ) AND NOT EXISTS (
    SELECT 1 FROM order_items oi WHERE oi.order_id = orders.id AND oi.status <> 'CANCELLED' AND oi.skip_kitchen = FALSE
  ) THEN 'READY' ELSE 'ACCEPTED' END`;

/**
 * Ready-made items skip the kitchen, so there's no "kitchen finished" tap to
 * trigger the waiter alert. Fire the same ROUND_READY event + push right when
 * they are ordered (or, for online-paid orders, when payment is confirmed).
 * Never throws — a failed alert must not fail the order.
 */
export async function notifyReadyMadeRound(restaurantId: string, orderId: string, round: number | null): Promise<void> {
  if (!round) return;
  try {
    const info = await ordersRepository.getRoundReadyInfo(orderId, round);
    if (!info) return;
    const label = info.table_number ? `Table ${info.table_number}` : `Order ${info.order_number}`;
    eventBroadcaster?.broadcastRoundReady({
      order_id: orderId,
      restaurant_id: restaurantId,
      order_number: info.order_number,
      table_number: info.table_number,
      round,
    });
    pushService
      .sendToRestaurant(restaurantId, {
        title: `${label} — ready to serve`,
        body: `Ready-made items for ${info.order_number} can be served now`,
        tag: `ready-${orderId}-${round}`,
        data: { url: '/orders' },
      }, ['WAITER', 'RECEPTION'])
      .catch(() => {});
  } catch (err) {
    console.error('[Orders] Ready-made notify failed:', (err as any)?.message || err);
  }
}

/**
 * For paths where the order was already created earlier and only now becomes
 * visible to staff (online payment confirmed): alert for every ready-made round
 * that hasn't been served yet.
 */
export async function notifyPendingReadyMadeRounds(restaurantId: string, orderId: string): Promise<void> {
  try {
    const rows = await query(
      `SELECT DISTINCT round FROM order_items
       WHERE order_id = $1 AND skip_kitchen = TRUE AND served_at IS NULL AND status <> 'CANCELLED'`,
      [orderId],
    );
    for (const r of rows.rows) {
      await notifyReadyMadeRound(restaurantId, orderId, Number(r.round));
    }
  } catch (err) {
    console.error('[Orders] Pending ready-made notify failed:', (err as any)?.message || err);
  }
}
