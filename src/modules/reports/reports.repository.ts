import { query } from "@/config/database";
import {
  DashboardReport,
  DailyRevenuePoint,
  InventoryAlert,
  TopSellingItem,
  PaymentModeRow,
} from "./reports.types";
import { isToday, todayLocal, localDay } from '@/shared/businessTime';

export class ReportsRepository {
  async getDashboardReport(restaurantId: string): Promise<DashboardReport> {
    const result = await query(
      `SELECT
         (SELECT COUNT(*)
          FROM orders
          WHERE restaurant_id = $1
          AND ${isToday('created_at')}) AS total_orders_today,

         (SELECT COUNT(*)
          FROM orders
          WHERE restaurant_id = $1
          AND status = 'COMPLETED'
          AND ${isToday('created_at')}) AS completed_orders_today,

         (SELECT COUNT(*)
          FROM orders
          WHERE restaurant_id = $1
          AND status = 'CANCELLED'
          AND ${isToday('created_at')}) AS cancelled_orders_today,

         (SELECT COUNT(*)
          FROM orders
          WHERE restaurant_id = $1
          AND status NOT IN ('COMPLETED', 'CANCELLED')
          AND ${isToday('created_at')}) AS active_orders,

         (SELECT COALESCE(SUM(amount), 0)
          FROM payments
          WHERE restaurant_id = $1
          AND status = 'PAID'
          AND ${isToday('created_at')}) AS revenue_today,

         (SELECT COUNT(*)
          FROM payments
          WHERE restaurant_id = $1
          AND ${isToday('created_at')}) AS payments_today,

         (SELECT COALESCE(SUM(amount), 0)
          FROM payments
          WHERE restaurant_id = $1
          AND status = 'PAID'
          AND ${isToday('created_at')}) AS paid_amount_today,

         (SELECT COALESCE(SUM(amount), 0)
          FROM payments
          WHERE restaurant_id = $1
          AND status = 'REFUNDED'
          AND ${isToday('created_at')}) AS refunded_amount_today,

         (SELECT COUNT(*)
          FROM inventory_items
          WHERE restaurant_id = $1
          AND current_stock <= reorder_level) AS low_stock_items,

         (SELECT COUNT(DISTINCT o.table_id)
          FROM orders o
          WHERE o.restaurant_id = $1
          AND o.table_id IS NOT NULL
          AND o.status NOT IN ('COMPLETED', 'CANCELLED')) AS occupied_tables
      `,
      [restaurantId],
    );

    const row = result.rows[0];

    return {
      total_orders_today: parseInt(row.total_orders_today, 10) || 0,
      completed_orders_today: parseInt(row.completed_orders_today, 10) || 0,
      cancelled_orders_today: parseInt(row.cancelled_orders_today, 10) || 0,
      active_orders: parseInt(row.active_orders, 10) || 0,
      revenue_today: parseFloat(row.revenue_today) || 0,
      payments_today: parseInt(row.payments_today, 10) || 0,
      paid_amount_today: parseFloat(row.paid_amount_today) || 0,
      refunded_amount_today: parseFloat(row.refunded_amount_today) || 0,
      low_stock_items: parseInt(row.low_stock_items, 10) || 0,
      occupied_tables: parseInt(row.occupied_tables, 10) || 0,
    };
  }

  /**
   * Best sellers by quantity. Cancelled orders never count as sold.
   * With `range`, only orders placed on those dates count, in the business
   * timezone (BUSINESS_TZ) — used for the dashboard's "today" list.
   */
  async getTopSellingItems(
    restaurantId: string,
    limit: number,
    range?: { from: string; to: string },
    sort: 'quantity' | 'revenue' = 'quantity',
  ): Promise<TopSellingItem[]> {
    let dateFilter = '';
    const params: unknown[] = [restaurantId, limit];

    if (range) {
      // Same business timezone as the dashboard and revenue chart (BUSINESS_TZ)
      dateFilter = `AND ${localDay('o.created_at')} BETWEEN $3::date AND $4::date`;
      params.push(range.from, range.to);
    }

    // Fixed strings only (never user input), so safe to put in the SQL
    const orderBy =
      sort === 'revenue'
        ? 'total_revenue DESC, total_quantity DESC'
        : 'total_quantity DESC, total_revenue DESC';

    const result = await query(
      `SELECT
         oi.menu_item_id,
         mi.name,
         SUM(oi.quantity) AS total_quantity,
         COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS total_revenue,
         COALESCE(SUM(oi.weight_grams), 0) AS total_weight_grams
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN menu_items mi ON oi.menu_item_id = mi.id
       WHERE o.restaurant_id = $1
         AND o.status <> 'CANCELLED'
         AND oi.status <> 'CANCELLED'
         ${dateFilter}
       GROUP BY oi.menu_item_id, mi.name
       ORDER BY ${orderBy}
       LIMIT $2`,
      params,
    );

    return result.rows.map((row) => ({
      menu_item_id: row.menu_item_id,
      name: row.name,
      total_quantity: parseInt(row.total_quantity, 10) || 0,

      total_revenue: parseFloat(row.total_revenue) || 0,
      total_weight_grams: parseInt(row.total_weight_grams, 10) || 0,
    }));
  }

  /**
   * Daily revenue = money actually received (payments with status PAID).
   * Refunded payments change status to REFUNDED, so they are already excluded;
   * nothing is subtracted again. Matches the payments report.
   */
  async getDailyRevenue(
    restaurantId: string,
    days: number,
  ): Promise<DailyRevenuePoint[]> {
    const result = await query(
      `SELECT
         to_char(date_series, 'YYYY-MM-DD') AS date,
         COALESCE(SUM(p.amount), 0) AS revenue
       FROM generate_series(
         ${todayLocal} - ($2 - 1) * INTERVAL '1 day',
         ${todayLocal},
         '1 day'
       ) AS date_series
       LEFT JOIN payments p
         ON ${localDay('p.created_at')} = date_series
         AND p.restaurant_id = $1
         AND p.status = 'PAID'
       GROUP BY date_series
       ORDER BY date_series ASC`,
      [restaurantId, days],
    );

    return result.rows.map((row) => ({
      date: row.date,
      revenue: parseFloat(row.revenue) || 0,
    }));
  }

  async getInventoryAlerts(restaurantId: string): Promise<InventoryAlert[]> {
    const result = await query(
      `SELECT
         i.id AS inventory_item_id,
         i.menu_item_id,
         mi.name AS menu_item_name,
         i.current_stock,
         i.reorder_level
       FROM inventory_items i
       JOIN menu_items mi
         ON mi.id = i.menu_item_id
       WHERE i.restaurant_id = $1
       AND i.current_stock <= i.reorder_level
       ORDER BY i.current_stock ASC`,
      [restaurantId],
    );

    return result.rows.map((row) => ({
      inventory_item_id: row.inventory_item_id,
      menu_item_id: row.menu_item_id,
      menu_item_name: row.menu_item_name,
      current_stock: parseInt(row.current_stock, 10) || 0,

      reorder_level: parseInt(row.reorder_level, 10) || 0,
    }));
  }
  /**
   * Money received per payment mode between two business-local dates (inclusive).
   * payments.created_at is stored as UTC without a zone, so it is converted to the
   * business timezone (BUSINESS_TZ) before taking the date, exactly like the
   * dashboard and the daily revenue chart.
   */
  async getPaymentModes(
    restaurantId: string,
    from: string,
    to: string,
  ): Promise<PaymentModeRow[]> {
    const result = await query(
      `SELECT
         method::text AS method,
         COALESCE(SUM(amount) FILTER (WHERE status = 'PAID'), 0)     AS paid_amount,
         COUNT(*)             FILTER (WHERE status = 'PAID')         AS paid_count,
         COALESCE(SUM(amount) FILTER (WHERE status = 'REFUNDED'), 0) AS refunded_amount,
         COALESCE(SUM(amount) FILTER (WHERE status = 'PENDING'), 0)  AS pending_amount
       FROM payments
       WHERE restaurant_id = $1
         AND ${localDay('created_at')} BETWEEN $2::date AND $3::date
       GROUP BY method`,
      [restaurantId, from, to],
    );

    // Always return all four modes, even when one has no payments in the range
    const byMethod = new Map(result.rows.map((r) => [r.method, r]));
    return (['CASH', 'UPI', 'CARD', 'ONLINE'] as const).map((m) => {
      const r = byMethod.get(m);
      return {
        method: m,
        paid_amount: Number(r?.paid_amount) || 0,
        paid_count: parseInt(r?.paid_count, 10) || 0,
        refunded_amount: Number(r?.refunded_amount) || 0,
        pending_amount: Number(r?.pending_amount) || 0,
      };
    });
  }
}

export const reportsRepository = new ReportsRepository();
