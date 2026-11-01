import { reportsRepository } from './reports.repository';
import { DashboardReport, DailyRevenuePoint, InventoryAlert, TopSellingItem, PaymentModesReport } from './reports.types';
import { BadRequestError } from '@/shared/errors/AppError';

export class ReportsService {
  async getDashboardReport(restaurantId: string): Promise<DashboardReport> {
    return reportsRepository.getDashboardReport(restaurantId);
  }

  async getTopSellingItems(restaurantId: string, limit: number): Promise<TopSellingItem[]> {
    return reportsRepository.getTopSellingItems(restaurantId, limit);
  }

  async getDailyRevenue(restaurantId: string, days: number): Promise<DailyRevenuePoint[]> {
    return reportsRepository.getDailyRevenue(restaurantId, days);
  }

  async getPaymentModes(restaurantId: string, from: string, to: string, tz?: string): Promise<PaymentModesReport> {
    // Only accept a real IANA zone name; fall back to India time (this app's default market).
    let zone = 'Asia/Kolkata';
    if (tz) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        zone = tz;
      } catch {
        throw new BadRequestError('Unknown time zone');
      }
    }

    // Keep the range sane so one request can't scan years of payments
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
    if (days > 366) throw new BadRequestError('Date range can be at most one year');

    const modes = await reportsRepository.getPaymentModes(restaurantId, from, to, zone);
    const sum = (f: (m: (typeof modes)[number]) => number) => modes.reduce((s, m) => s + f(m), 0);
    return {
      from,
      to,
      tz: zone,
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
