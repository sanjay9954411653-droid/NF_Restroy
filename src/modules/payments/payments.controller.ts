import { Request, Response, NextFunction } from 'express';
import { paymentsService } from './payments.service';
import { CreatePaymentRequestSchema, UpdatePaymentRequestSchema } from './payments.types';
import { successResponse } from '@/shared/utils/responseHandler';
import { parsePagination, paginatedResponse } from '@/shared/utils/pagination';
import { AuthenticatedRequest } from '@/shared/middleware/authenticate';
import { assertCanCollectPayment } from '@/shared/waiterPaymentAccess';
import { eventBroadcaster } from '@/shared/socket/eventBroadcaster';

export class PaymentsController {
  async create(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) throw new Error('User not associated with a restaurant');

      await assertCanCollectPayment(req.user);
      const payload = CreatePaymentRequestSchema.parse(req.body);
      const payment = await paymentsService.createPayment(restaurantId, payload);

      eventBroadcaster?.broadcastPaymentCreated({
        payment_id: payment.id,
        restaurant_id: restaurantId,
        order_id: payment.order_id,
        status: payment.status,
        amount: Number(payment.amount),
      });

      res.status(201).json(successResponse(payment, { message: 'Payment created successfully' }));
    } catch (error) {
      next(error);
    }
  }

  /** Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD (business days, both included). Both or neither. */
  private dateRange(req: AuthenticatedRequest): { from?: string; to?: string } {
    const ok = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const { from, to } = req.query;
    return ok(from) && ok(to) && from <= to ? { from, to } : {};
  }

  async summary(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) throw new Error('User not associated with a restaurant');
      const { from, to } = this.dateRange(req);
      res.status(200).json(successResponse(await paymentsService.getSummary(restaurantId, from, to)));
    } catch (error) {
      next(error);
    }
  }

  async list(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) {
        throw new Error('User not associated with a restaurant');
      }

      const pagination = parsePagination(req.query);
      const statusFilter = req.query.status as string | undefined;
      const method = req.query.method as string | undefined;

      const { from, to } = this.dateRange(req);
      const { items, total } = await paymentsService.getPayments(
        restaurantId, pagination.limit, pagination.offset, statusFilter, method, from, to,
      );
      res.status(200).json(successResponse(paginatedResponse(items, total, pagination)));
    } catch (error) {
      next(error);
    }
  }

  async getById(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) {
        throw new Error('User not associated with a restaurant');
      }

      const { id } = req.params;
      const payment = await paymentsService.getPayment(id, restaurantId);
      res.status(200).json(successResponse(payment));
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) {
        throw new Error('User not associated with a restaurant');
      }

      const { id } = req.params;
      const payload = UpdatePaymentRequestSchema.parse(req.body);
      const payment = await paymentsService.updatePayment(id, restaurantId, payload);
      res.status(200).json(successResponse(payment, { message: 'Payment updated successfully' }));
    } catch (error) {
      next(error);
    }
  }

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) {
        throw new Error('User not associated with a restaurant');
      }

      const { id } = req.params;
      await paymentsService.deletePayment(id, restaurantId);
      res.status(200).json(successResponse({ message: 'Payment deleted successfully' }));
    } catch (error) {
      next(error);
    }
  }

  async getStats(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) {
        throw new Error('User not associated with a restaurant');
      }

      const stats = await paymentsService.getPaymentStats(restaurantId);
      res.status(200).json(successResponse(stats));
    } catch (error) {
      next(error);
    }
  }
}

export const paymentsController = new PaymentsController();
