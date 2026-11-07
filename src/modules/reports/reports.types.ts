import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// With no dates this is the all-time list (Reports page). The dashboard sends
// today's date so the list starts fresh every day, in the owner's own timezone.
export const TopItemsQuerySchema = z
  .object({
    limit: z.preprocess((value) => Number(value), z.number().int().min(1).max(50).default(10)),
    // Rank by units sold (default) or by money made
    sort: z.enum(['quantity', 'revenue']).default('quantity'),
    from: isoDate.optional(),
    to: isoDate.optional(),
    tz: z.string().max(64).optional(),
    offset: z.preprocess(
      (v) => (v === undefined || v === '' ? undefined : Number(v)),
      z.number().int().min(-840).max(840).optional(),
    ),
  })
  .refine((q) => (q.from === undefined) === (q.to === undefined), {
    message: 'Send both "from" and "to", or neither',
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '"from" must not be after "to"' });

export const DailyRevenueQuerySchema = z.object({
  days: z.preprocess((value) => Number(value), z.number().int().min(1).max(90).default(7)),
});

export const PaymentModesQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    // Accepted for older clients but ignored: reports always use the server's BUSINESS_TZ.
    tz: z.string().max(64).optional(),
    offset: z.preprocess(
      (v) => (v === undefined || v === '' ? undefined : Number(v)),
      z.number().int().min(-840).max(840).optional(),
    ),
  })
  .refine((q) => q.from <= q.to, { message: '"from" must not be after "to"' });

export const OrderBreakdownQuerySchema = PaymentModesQuerySchema;

export type PaymentModesQuery = z.infer<typeof PaymentModesQuerySchema>;

export type TopItemsQuery = z.infer<typeof TopItemsQuerySchema>;
export type DailyRevenueQuery = z.infer<typeof DailyRevenueQuerySchema>;

export interface DashboardReport {
  total_orders_today: number;
  completed_orders_today: number;
  cancelled_orders_today: number;
  revenue_today: number;
  payments_today: number;
  paid_amount_today: number;
  refunded_amount_today: number;
  low_stock_items: number;
  occupied_tables: number;
  active_orders: number;
}

export interface TopSellingItem {
  menu_item_id: string;
  name: string;
  total_quantity: number;
  total_revenue: number;
  /** Total weight sold, in grams, for items sold by kg / 100 g (0 for normal items) */
  total_weight_grams: number;
}

export interface PaymentModeRow {
  method: 'CASH' | 'UPI' | 'CARD' | 'ONLINE';
  paid_amount: number;
  paid_count: number;
  refunded_amount: number;
  pending_amount: number;
}

export interface PaymentModesReport {
  from: string;
  to: string;
  tz: string;
  modes: PaymentModeRow[];
  total_paid: number;
  total_paid_count: number;
  total_refunded: number;
  total_pending: number;
}

export interface DailyRevenuePoint {
  date: string;
  revenue: number;
}

export interface InventoryAlert {
  inventory_item_id: string;
  menu_item_id: string;
  menu_item_name: string;
  current_stock: number;
  reorder_level: number;
}

export interface OrderBreakdownRow {
  key: string;
  orders: number;
  amount: number;
}

export interface StaffOrderRow {
  user_id: string | null;
  name: string;
  role: string | null;
  orders: number;
  amount: number;
}

export interface OrderBreakdownReport {
  from: string;
  to: string;
  tz: string;
  total_orders: number;
  total_amount: number;
  by_source: OrderBreakdownRow[];
  by_type: OrderBreakdownRow[];
  by_staff: StaffOrderRow[];
}
