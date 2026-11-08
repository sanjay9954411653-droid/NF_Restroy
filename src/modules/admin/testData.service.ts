/**
 * Super-admin tool: preview, back up and clear a restaurant's test data.
 *
 * What it can remove (always for ONE restaurant, never touches menu, tables, users, settings, billing):
 *   - orders  (their items, modifiers and payments go with them automatically)
 *   - optionally: loyalty points + coupon usage, reviews, reservations, table requests,
 *     inventory usage history, print jobs
 *
 * Which orders:
 *   mode "range"  — placed between two dates (business timezone, both days included)
 *   mode "before" — placed before a date
 *   mode "all"    — every order
 *   mode "test"   — only orders flagged is_test (placed while Demo mode was on)
 * Open orders (not completed / cancelled) are skipped unless include_open is true.
 */
import { z } from 'zod';
import { pool, query } from '@/config/database';
import { BUSINESS_TZ, localDay } from '@/shared/businessTime';
import { BadRequestError, NotFoundError } from '@/shared/errors/AppError';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const EXTRAS = ['loyalty', 'reviews', 'reservations', 'table_requests', 'inventory', 'print_jobs'] as const;

export const TestDataFilterSchema = z
  .object({
    mode: z.enum(['range', 'before', 'all', 'test']),
    from: DATE.optional(),
    to: DATE.optional(),
    before: DATE.optional(),
    include_open: z.boolean().default(false),
    include: z.array(z.enum(EXTRAS)).default([]),
    confirm_name: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'range') {
      if (!v.from || !v.to) ctx.addIssue({ code: 'custom', message: 'Choose a from and to date' });
      else if (v.from > v.to) ctx.addIssue({ code: 'custom', message: '"From" must not be after "To"' });
    }
    if (v.mode === 'before' && !v.before) ctx.addIssue({ code: 'custom', message: 'Choose the "before" date' });
  });

export type TestDataFilter = z.infer<typeof TestDataFilterSchema>;
export const DemoModeSchema = z.object({ enabled: z.boolean() });

const CLOSED = "('COMPLETED','CANCELLED')";

/** WHERE for the orders to clear. $1 is always the restaurant id. */
function orderWhere(f: TestDataFilter, withOpenRule = true): { sql: string; params: unknown[] } {
  const parts = ['o.restaurant_id = $1'];
  const params: unknown[] = [];
  if (withOpenRule && !f.include_open) parts.push(`o.status IN ${CLOSED}`);
  if (f.mode === 'range') {
    parts.push(`${localDay('o.created_at')} BETWEEN $2::date AND $3::date`);
    params.push(f.from, f.to);
  } else if (f.mode === 'before') {
    parts.push(`${localDay('o.created_at')} < $2::date`);
    params.push(f.before);
  } else if (f.mode === 'test') {
    parts.push('o.is_test = TRUE');
  }
  return { sql: parts.join(' AND '), params };
}

/** Date condition for other tables (by their own created_at). null = this table is not part of this mode. */
function otherDate(col: string, tz: boolean, f: TestDataFilter): { sql: string; params: unknown[] } | null {
  if (f.mode === 'test') return null; // test mode only clears flagged orders and what hangs off them
  const day = tz ? `(${col} AT TIME ZONE '${BUSINESS_TZ}')::date` : localDay(col);
  if (f.mode === 'all') return { sql: 'TRUE', params: [] };
  if (f.mode === 'before') return { sql: `${day} < $2::date`, params: [f.before] };
  return { sql: `${day} BETWEEN $2::date AND $3::date`, params: [f.from, f.to] };
}

const num = (v: unknown): number => parseInt(String(v ?? 0), 10) || 0;

async function loadRestaurant(id: string): Promise<{ id: string; name: string; demo_mode: boolean }> {
  const r = await query('SELECT id, name, demo_mode FROM restaurants WHERE id = $1', [id]);
  if (r.rows.length === 0) throw new NotFoundError('Restaurant not found');
  return r.rows[0];
}

export const testDataService = {
  async setDemoMode(restaurantId: string, enabled: boolean) {
    await loadRestaurant(restaurantId);
    await query('UPDATE restaurants SET demo_mode = $2, updated_at = NOW() WHERE id = $1', [restaurantId, enabled]);
    return { demo_mode: enabled };
  },

  /** Counts + a sample, so the super admin sees exactly what will go before confirming. */
  async preview(restaurantId: string, f: TestDataFilter) {
    const restaurant = await loadRestaurant(restaurantId);
    const w = orderWhere(f);
    const p = [restaurantId, ...w.params];

    const main = await query(
      `SELECT COUNT(*) AS orders,
              COALESCE(SUM(o.total_amount) FILTER (WHERE o.status <> 'CANCELLED'), 0) AS order_value,
              MIN(o.created_at) AS first_at, MAX(o.created_at) AS last_at,
              COUNT(*) FILTER (WHERE o.is_test) AS flagged_test
       FROM orders o WHERE ${w.sql}`,
      p,
    );
    const items = await query(
      `SELECT COUNT(*) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE ${w.sql}`, p);
    const pay = await query(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(pm.amount) FILTER (WHERE pm.status = 'PAID'), 0) AS paid
       FROM payments pm JOIN orders o ON o.id = pm.order_id WHERE ${w.sql}`, p);

    // Orders that match everything except being "open" — skipped unless include_open
    let openSkipped = 0;
    if (!f.include_open) {
      const wAll = orderWhere(f, false);
      const r = await query(
        `SELECT COUNT(*) AS n FROM orders o WHERE ${wAll.sql} AND o.status NOT IN ${CLOSED}`,
        [restaurantId, ...wAll.params],
      );
      openSkipped = num(r.rows[0].n);
    }

    const sample = await query(
      `SELECT o.id, o.order_number, o.status, o.order_type, o.order_source, o.total_amount, o.is_test, o.created_at
       FROM orders o WHERE ${w.sql} ORDER BY o.created_at DESC LIMIT 10`, p);

    const extras: Record<string, number> = {};
    const idsSql = `SELECT o.id FROM orders o WHERE ${w.sql}`;
    if (f.include.includes('loyalty')) {
      const r = await query(`SELECT COUNT(*) AS n FROM loyalty_ledger WHERE restaurant_id = $1 AND order_id IN (${idsSql})`, p);
      extras.loyalty = num(r.rows[0].n);
    }
    if (f.include.includes('reviews')) {
      const r = await query(`SELECT COUNT(*) AS n FROM reviews WHERE restaurant_id = $1 AND order_id IN (${idsSql})`, p);
      extras.reviews = num(r.rows[0].n);
    }
    const dated: [typeof EXTRAS[number], string, string, boolean, string?][] = [
      ['reservations', 'reservations', 'created_at', false],
      ['table_requests', 'table_requests', 'created_at', true],
      ['inventory', 'inventory_transactions', 'created_at', false, "AND transaction_type = 'USAGE'"],
      ['print_jobs', 'print_jobs', 'created_at', false],
    ];
    for (const [key, table, col, tz, extra] of dated) {
      if (!f.include.includes(key)) continue;
      const d = otherDate(col, tz, f);
      if (!d) { extras[key] = 0; continue; }
      const r = await query(
        `SELECT COUNT(*) AS n FROM ${table} WHERE restaurant_id = $1 AND ${d.sql} ${extra ?? ''}`,
        [restaurantId, ...d.params],
      );
      extras[key] = num(r.rows[0].n);
    }

    const m = main.rows[0];
    return {
      restaurant: { id: restaurant.id, name: restaurant.name, demo_mode: restaurant.demo_mode },
      orders: num(m.orders),
      order_items: num(items.rows[0].n),
      payments: num(pay.rows[0].n),
      paid_revenue: parseFloat(pay.rows[0].paid) || 0,
      order_value: parseFloat(m.order_value) || 0,
      first_order_at: m.first_at,
      last_order_at: m.last_at,
      open_orders_skipped: openSkipped,
      extras,
      sample: sample.rows,
    };
  },

  /** Everything that is about to be deleted, as JSON the super admin can keep. */
  async backup(restaurantId: string, f: TestDataFilter) {
    const restaurant = await loadRestaurant(restaurantId);
    const w = orderWhere(f);
    const p = [restaurantId, ...w.params];
    const count = await query(`SELECT COUNT(*) AS n FROM orders o WHERE ${w.sql}`, p);
    if (num(count.rows[0].n) > 20000) {
      throw new BadRequestError('Too many orders for one backup (over 20,000). Narrow the date range.');
    }
    const orders = await query(
      `SELECT o.*,
         COALESCE((SELECT json_agg(oi ORDER BY oi.created_at) FROM order_items oi WHERE oi.order_id = o.id), '[]'::json) AS items,
         COALESCE((SELECT json_agg(pm ORDER BY pm.created_at) FROM payments pm WHERE pm.order_id = o.id), '[]'::json) AS payments
       FROM orders o WHERE ${w.sql} ORDER BY o.created_at`,
      p,
    );
    return {
      exported_at: new Date().toISOString(),
      restaurant: { id: restaurant.id, name: restaurant.name },
      filter: { mode: f.mode, from: f.from, to: f.to, before: f.before, include_open: f.include_open },
      order_count: orders.rows.length,
      orders: orders.rows,
    };
  },

  /** Deletes everything chosen, in ONE transaction (all or nothing), and writes the audit log. */
  async clear(restaurantId: string, f: TestDataFilter, performedBy: string) {
    const restaurant = await loadRestaurant(restaurantId);
    if (!f.confirm_name || f.confirm_name.trim().toLowerCase() !== restaurant.name.trim().toLowerCase()) {
      throw new BadRequestError('Type the restaurant name exactly to confirm');
    }

    const w = orderWhere(f);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const idRows = await client.query(`SELECT o.id FROM orders o WHERE ${w.sql}`, [restaurantId, ...w.params]);
      const ids: string[] = idRows.rows.map((r) => r.id);
      const counts: Record<string, number> = { orders: ids.length };

      if (ids.length > 0) {
        const pay = await client.query('SELECT COUNT(*) AS n FROM payments WHERE order_id = ANY($1::uuid[])', [ids]);
        counts.payments = num(pay.rows[0].n);

        if (f.include.includes('loyalty')) {
          // Take the earned points back (and give redeemed points back), then drop the ledger rows
          await client.query(
            `UPDATE loyalty_accounts la
                SET points_balance = GREATEST(0, la.points_balance - s.pts), updated_at = NOW()
               FROM (SELECT customer_id, SUM(points) AS pts FROM loyalty_ledger
                      WHERE restaurant_id = $1 AND order_id = ANY($2::uuid[]) GROUP BY customer_id) s
              WHERE la.restaurant_id = $1 AND la.customer_id = s.customer_id`,
            [restaurantId, ids],
          );
          const led = await client.query(
            'DELETE FROM loyalty_ledger WHERE restaurant_id = $1 AND order_id = ANY($2::uuid[])', [restaurantId, ids]);
          counts.loyalty_rows = led.rowCount ?? 0;

          await client.query(
            `UPDATE coupons c
                SET used_count = GREATEST(0, c.used_count - s.n), updated_at = NOW()
               FROM (SELECT UPPER(coupon_code) AS code, COUNT(*) AS n FROM orders
                      WHERE id = ANY($2::uuid[]) AND coupon_code IS NOT NULL AND status <> 'CANCELLED'
                      GROUP BY UPPER(coupon_code)) s
              WHERE c.restaurant_id = $1 AND UPPER(c.code) = s.code`,
            [restaurantId, ids],
          );
        }
        if (f.include.includes('reviews')) {
          const r = await client.query(
            'DELETE FROM reviews WHERE restaurant_id = $1 AND order_id = ANY($2::uuid[])', [restaurantId, ids]);
          counts.reviews = r.rowCount ?? 0;
        }
      }

      const dated: [typeof EXTRAS[number], string, boolean, string?][] = [
        ['reservations', 'reservations', false],
        ['table_requests', 'table_requests', true],
        ['inventory', 'inventory_transactions', false, "AND transaction_type = 'USAGE'"],
        ['print_jobs', 'print_jobs', false],
      ];
      for (const [key, table, tz, extra] of dated) {
        if (!f.include.includes(key)) continue;
        const d = otherDate('created_at', tz, f);
        if (!d) { counts[key] = 0; continue; }
        const r = await client.query(
          `DELETE FROM ${table} WHERE restaurant_id = $1 AND ${d.sql} ${extra ?? ''}`,
          [restaurantId, ...d.params],
        );
        counts[key] = r.rowCount ?? 0;
      }

      if (ids.length > 0) {
        // order_items, item modifiers and payments are removed by ON DELETE CASCADE
        await client.query('DELETE FROM orders WHERE restaurant_id = $1 AND id = ANY($2::uuid[])', [restaurantId, ids]);
      }

      await client.query(
        `INSERT INTO data_clear_log (restaurant_id, restaurant_name, performed_by, filter, counts)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
        [
          restaurantId, restaurant.name, performedBy,
          JSON.stringify({ mode: f.mode, from: f.from, to: f.to, before: f.before, include_open: f.include_open, include: f.include }),
          JSON.stringify(counts),
        ],
      );

      await client.query('COMMIT');
      return counts;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },

  async log(restaurantId: string) {
    const r = await query(
      `SELECT id, performed_by, filter, counts, created_at
       FROM data_clear_log WHERE restaurant_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [restaurantId],
    );
    return r.rows;
  },
};
