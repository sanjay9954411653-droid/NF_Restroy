import { reportsRepository } from './reports.repository';
import { DashboardReport, DailyRevenuePoint, InventoryAlert, TopSellingItem, PaymentModesReport } from './reports.types';
import { BadRequestError } from '@/shared/errors/AppError';
import { BUSINESS_TZ } from '@/shared/businessTime';

export class ReportsService {
  async getDashboardReport(restaurantId: string): Promise<DashboardReport> {
    return reportsRepository.getDashboardReport(restaurantId);
  }

  async getTopSellingItems(
    restaurantId: string,
    limit: number,
    range?: { from: string; to: string },
    sort: 'quantity' | 'revenue' = 'quantity',
  ): Promise<TopSellingItem[]> {
    if (!range) return reportsRepository.getTopSellingItems(restaurantId, limit, undefined, sort);

    // Dates are business-local days (BUSINESS_TZ); a client's tz/offset is ignored
    // so every report agrees on where "today" starts.
    const days = (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000 + 1;
    if (days > 366) throw new BadRequestError('Date range can be at most one year');

    return reportsRepository.getTopSellingItems(restaurantId, limit, { from: range.from, to: range.to }, sort);
  }

  async getDailyRevenue(restaurantId: string, days: number): Promise<DailyRevenuePoint[]> {
    return reportsRepository.getDailyRevenue(restaurantId, days);
  }

  async getPaymentModes(restaurantId: string, from: string, to: string): Promise<PaymentModesReport> {
    // Keep the range sane so one request can't scan years of payments
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
    if (days > 366) throw new BadRequestError('Date range can be at most one year');

    const modes = await reportsRepository.getPaymentModes(restaurantId, from, to);
    const sum = (f: (m: (typeof modes)[number]) => number) => modes.reduce((s, m) => s + f(m), 0);
    return {
      from,
      to,
      tz: BUSINESS_TZ,
      modes,
      total_paid: sum((m) => m.paid_amount),
      total_paid_count: sum((m) => m.paid_count),
      total_refunded: sum((m) => m.refunded_amount),
      total_pending: sum((m) => m.pending_amount),
    };
  }

  async getInventoryAlerts(restaurantId: string): Promise<InventoryAlert[]> {
    return reportsRepository.getInventoryAlerts(restaurantId);
  }
}

export const reportsService = new ReportsService();
