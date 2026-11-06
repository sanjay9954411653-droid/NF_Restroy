import { query } from '@/config/database';
import { webpush, pushEnabled } from '@/config/webpush';

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
}

class PushService {
  async saveSubscription(
    userId: string,
    restaurantId: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  ): Promise<void> {
    await query(
      `INSERT INTO push_subscriptions (user_id, restaurant_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id, restaurant_id = EXCLUDED.restaurant_id,
             p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [userId, restaurantId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth],
    );
  }

  async removeSubscription(endpoint: string): Promise<void> {
    await query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
  }

  /**
   * Push a notification to staff devices subscribed for this restaurant.
   * Pass `roles` to target only certain staff roles (e.g. only KITCHEN
   * devices for a new order, only WAITER/RECEPTION for an order going
   * READY) — omit it to send to every subscribed device regardless of
   * role. Silently does nothing if VAPID keys aren't configured.
   * Expired/invalid subscriptions (410/404 from the push service, e.g.
   * the app was uninstalled) are cleaned up automatically.
   */
  async sendToRestaurant(
  restaurantId: string,
  payload: PushPayload,
  roles?: Array<'ADMIN' | 'WAITER' | 'RECEPTION' | 'KITCHEN'>,
): Promise<void> {
    if (!pushEnabled) {
      // eslint-disable-next-line no-console
      console.log('Push: skipped — VAPID keys not configured (pushEnabled=false)');
      return;
    }

    const result = await query(
      `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth, u.role
 FROM push_subscriptions ps
 JOIN users u ON u.id = ps.user_id
 WHERE ps.restaurant_id = $1
   AND ($2::user_role[] IS NULL OR u.role = ANY($2::user_role[]))
   AND u.is_active = true`,
     [restaurantId, roles && roles.length > 0 ? roles : null],
    );

    // eslint-disable-next-line no-console
    console.log(
      `Push: restaurant=${restaurantId} roles=${roles ? roles.join(',') : 'ANY'} tag=${payload.tag ?? ''} matched ${result.rows.length} subscription(s)` +
      (result.rows.length ? ` [${result.rows.map((r) => r.role).join(', ')}]` : ''),
    );
    if (result.rows.length === 0) return;

    const body = JSON.stringify(payload);

    await Promise.all(
      result.rows.map(async (row) => {
        const tail = row.endpoint.slice(-16);
        try {
          await webpush.sendNotification(
            { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
            body,
            // Deliver immediately (Android otherwise may hold it while the phone dozes)
            // and drop it after 2 minutes so a "Call Waiter" never arrives hours late.
            { TTL: 120, urgency: 'high' },
          );
          // eslint-disable-next-line no-console
          console.log(`Push: delivered OK to ...${tail} (role ${row.role})`);
        } catch (err: any) {
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            // Subscription is dead (browser data cleared, app uninstalled, etc.)
            // eslint-disable-next-line no-console
            console.log(`Push: dead subscription ...${tail} (status ${err.statusCode}) — removing`);
            await query(`DELETE FROM push_subscriptions WHERE id = $1`, [row.id]).catch(() => {});
          } else {
            // eslint-disable-next-line no-console
            console.error(`Push: FAILED to ...${tail} — status=${err?.statusCode} ${err?.message || err}`);
          }
        }
      }),
    );
  }
}

export const pushService = new PushService();
