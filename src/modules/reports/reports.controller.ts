import { Request, Response, NextFunction } from 'express';
import { reportsService } from './reports.service';
import { DailyRevenueQuerySchema, PaymentModesQuerySchema, TopItemsQuerySchema } from './reports.types';
import { successResponse } from '@/shared/utils/responseHandler';
import { AuthenticatedRequest } from '@/shared/middleware/authenticate';

export class ReportsController {
  async getDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) throw new Error('User not associated with a restaurant');

      const dashboard = await reportsService.getDashboardReport(restaurantId);
      res.status(200).json(successResponse(dashboard));
    } catch (error) {
      next(error);
    }
  }

  async getTopItems(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) throw new Error('User not associated with a restaurant');

      const query = TopItemsQuerySchema.parse(req.query);
      const items = await reportsService.getTopSellingItems(
        restaurantId,
        query.limit,
        query.from && query.to ? { from: query.from, to: query.to, tz: query.tz, offset: query.offset } : undefined,
        query.sort,
      );
      res.status(200).json(successResponse(items));
    } catch (error) {
      next(error);
    }
  }

  async getDailyRevenue(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) throw new Error('User not associated with a restaurant');

      const query = DailyRevenueQuerySchema.parse(req.query);
      const revenue = await reportsService.getDailyRevenue(restaurantId, query.days);
      res.status(200).json(successResponse(revenue));
    } catch (error) {
      next(error);
    }
  }

  async getPaymentModes(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) throw new Error('User not associated with a restaurant');

      const q = PaymentModesQuerySchema.parse(req.query);
      const report = await reportsService.getPaymentModes(restaurantId, q.from, q.to, q.tz, q.offset);
      res.status(200).json(successResponse(report));
    } catch (error) {
      next(error);
    }
  }

  async getInventoryAlerts(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) throw new Error('User not associated with a restaurant');

      const alerts = await reportsService.getInventoryAlerts(restaurantId);
      res.status(200).json(successResponse(alerts));
    } catch (error) {
      next(error);
    }
  }
}

export const reportsController = new ReportsController();
