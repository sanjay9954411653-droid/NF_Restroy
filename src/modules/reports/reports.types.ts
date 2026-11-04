import { z } from 'zod';

const topItemsDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const TopItemsQuerySchema = z
  .object({
    limit: z.preprocess((value) => Number(value), z.number().int().min(1).max(500).default(10)),
    // Optional range (restaurant's local calendar days, inclusive). Omitted = today only.
    from: topItemsDate.optional(),
    to: topItemsDate.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '"from" must not be after "to"' });

export const DailyRevenueQuerySchema = z.object({
  days: z.preprocess((value) => Number(value), z.number().int().min(1).max(90).default(7)),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const PaymentModesQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    // Browser's IANA time zone (e.g. Asia/Kolkata) so "today" means the restaurant's today, not UTC's.
    tz: z.string().max(64).optional(),
    // Browser's UTC offset in minutes (east positive, e.g. 330 for India). Used if the DB doesn't know the zone name.
    offset: z.preprocess(
      (v) => (v === undefined || v === '' ? undefined : Number(v)),
      z.number().int().min(-840).max(840).optional(),
    ),
  })
  .refine((q) => q.from <= q.to, { message: '"from" must not be after "to"' });

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
