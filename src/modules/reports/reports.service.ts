import { reportsRepository } from './reports.repository';
import { DashboardReport, DailyRevenuePoint, InventoryAlert, TopSellingItem, PaymentModesReport } from './reports.types';
import { BadRequestError } from '@/shared/errors/AppError';

export class ReportsService {
  async getDashboardReport(restaurantId: string): Promise<DashboardReport> {
    return reportsRepository.getDashboardReport(restaurantId);
  }

  async getTopSellingItems(
    restaurantId: string,
    limit: number,
    range?: { from: string; to: string; tz?: string; offset?: number },
  ): Promise<TopSellingItem[]> {
    if (!range) return reportsRepository.getTopSellingItems(restaurantId, limit);

    // Same timezone handling as the payment-modes report
    const LEGACY_ZONES: Record<string, string> = {
      'Asia/Calcutta': 'Asia/Kolkata',
      'Asia/Katmandu': 'Asia/Kathmandu',
      'Asia/Rangoon': 'Asia/Yangon',
      'Asia/Saigon': 'Asia/Ho_Chi_Minh',
      'Asia/Dacca': 'Asia/Dhaka',
      'Europe/Kiev': 'Europe/Kyiv',
      'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
    };
    const requested = range.tz && /^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+){0,2}$/.test(range.tz) ? range.tz : undefined;
    const zoneCandidates = [requested, requested && LEGACY_ZONES[requested], 'Asia/Kolkata'].filter(
      (z, i, arr): z is string => !!z && arr.indexOf(z) === i,
    );

    const days = (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000 + 1;
    if (days > 366) throw new BadRequestError('Date range can be at most one year');

    return reportsRepository.getTopSellingItems(restaurantId, limit, {
      from: range.from,
      to: range.to,
      zoneCandidates,
      offsetMinutes: range.offset ?? 330,
    });
  }

  async getDailyRevenue(restaurantId: string, days: number): Promise<DailyRevenuePoint[]> {
    return reportsRepository.getDailyRevenue(restaurantId, days);
  }

  async getPaymentModes(
    restaurantId: string,
    from: string,
    to: string,
    tz?: string,
    offsetMinutes?: number,
  ): Promise<PaymentModesReport> {
    // Phones often report old zone names (Asia/Calcutta) that some databases don't have.
    const LEGACY_ZONES: Record<string, string> = {
      'Asia/Calcutta': 'Asia/Kolkata',
      'Asia/Katmandu': 'Asia/Kathmandu',
      'Asia/Rangoon': 'Asia/Yangon',
      'Asia/Saigon': 'Asia/Ho_Chi_Minh',
      'Asia/Dacca': 'Asia/Dhaka',
      'Europe/Kiev': 'Europe/Kyiv',
      'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
    };
    const requested = tz && /^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+){0,2}$/.test(tz) ? tz : undefined;
    const candidates = [requested, requested && LEGACY_ZONES[requested], 'Asia/Kolkata'].filter(
      (z, i, arr): z is string => !!z && arr.indexOf(z) === i,
    );
    // Last resort offset if the database knows none of the names: the browser's, else India's (+5:30)
    const offset = offsetMinutes ?? 330;

    // Keep the range sane so one request can't scan years of payments
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
    if (days > 366) throw new BadRequestError('Date range can be at most one year');

    const modes = await reportsRepository.getPaymentModes(restaurantId, from, to, candidates, offset);
    const sum = (f: (m: (typeof modes)[number]) => number) => modes.reduce((s, m) => s + f(m), 0);
    return {
      from,
      to,
      tz: requested ?? 'Asia/Kolkata',
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
