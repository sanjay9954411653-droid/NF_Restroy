import { Request, Response, NextFunction } from 'express';
import { ordersService } from './orders.service';
import {
  CreateOrderRequest,
  UpdateOrderRequest,
  CreateOrderRequestSchema,
  UpdateOrderRequestSchema,
  AddOrderItemsRequestSchema,
  UpdateOrderItemStatusSchema,
  MarkKotPrintedSchema,
  ServeOrderSchema,
} from './orders.types';
import { successResponse } from '@/shared/utils/responseHandler';
import { parsePagination, paginatedResponse } from '@/shared/utils/pagination';
import { AuthenticatedRequest } from '@/shared/middleware/authenticate';
import { eventBroadcaster } from '@/shared/socket/eventBroadcaster';
import { clearDelayAlert } from '@/shared/jobs/delayDetector';
import { pushService } from '@/modules/push/push.service';
import { notifyReadyMadeRound } from '@/shared/readyMadeNotify';
import { printingService } from '@/modules/printing/printing.service';
import { assertTableAccess, assertOrderAccess, getWaiterAccess } from '@/shared/tableAccess';

export class OrdersController {
  async create(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) throw new Error('User not associated with a restaurant');

      const userId = req.user?.userId || null;
      const payload = CreateOrderRequestSchema.parse(req.body) as CreateOrderRequest;
      await assertTableAccess(req.user, payload.table_id);
      const result = await ordersService.createOrder(restaurantId, userId, payload);

      // Auto-KOT via the print bridge (before the kitchen screens are told, so nothing prints twice)
      await printingService.enqueueUnprintedKot(result.order.id, restaurantId)
        .catch((err) => console.error('[PrintBridge] KOT enqueue failed:', err?.message || err));

      // Broadcast real-time event
      eventBroadcaster?.broadcastOrderCreated({
        order_id: result.order.id,
        restaurant_id: restaurantId,
        status: result.order.status,
        total_amount: Number(result.order.total_amount),
        table_id: result.order.table_id,
      });
// Only ping the kitchen if there is something for it to cook
      if (result.items.some((i) => !i.skip_kitchen)) {
        pushService
          .sendToRestaurant(
            restaurantId,
            {
              title: '🔔 New order',
              body: `Order ${result.order.order_number} received in the kitchen`,
              tag: `new-order-${result.order.id}`,
              data: { url: '/kitchen', orderId: result.order.id },
            },
          )
          .catch((err) => console.error('Kitchen push notify failed:', err?.message || err));
      }

      // Ready-made items: tell the waiters right away (no kitchen step)
      await notifyReadyMadeRound(restaurantId, result.order.id, result.readyRound);
      res.status(201).json(successResponse(result, { message: 'Order created successfully' }));
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
      const status = req.query.status as string | undefined;
      const sortBy = req.query.sort_by as string | undefined;
      const sortOrder = req.query.sort_order as string | undefined;

      const allowedTables = await getWaiterAccess(req.user);
      const { items, total } = await ordersService.getOrders(
        restaurantId, pagination.limit, pagination.offset, status, sortBy, sortOrder, allowedTables,
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
      await assertOrderAccess(req.user, id);
      const order = await ordersService.getOrder(id, restaurantId);
      res.status(200).json(successResponse(order));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /orders/active/by-table/:tableId
   * Returns the open order for a table (if any) so the frontend can offer
   * "add to existing order" instead of creating a new one.
   */
  async getActiveByTable(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) {
        throw new Error('User not associated with a restaurant');
      }

      const { tableId } = req.params;
      await assertTableAccess(req.user, tableId);
      const result = await ordersService.getActiveOrderForTable(restaurantId, tableId);
      res.status(200).json(successResponse(result));
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /orders/:id/items
   * Append items to an existing open order (running tab).
   */
  async addItems(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) throw new Error('User not associated with a restaurant');

      const { id } = req.params;
      await assertOrderAccess(req.user, id);
      const payload = AddOrderItemsRequestSchema.parse(req.body);
      const result = await ordersService.addItemsToOrder(id, restaurantId, payload.items);

      await printingService.enqueueUnprintedKot(id, restaurantId)
        .catch((err) => console.error('[PrintBridge] KOT enqueue failed:', err?.message || err));

      // Broadcast as an update (items added = order updated)
      eventBroadcaster?.broadcastOrderUpdated({
        order_id: result.order.id,
        restaurant_id: restaurantId,
        status: result.order.status,
        total_amount: Number(result.order.total_amount),
        table_id: result.order.table_id,
      });

      // Ready-made items: tell the waiters right away (no kitchen step)
      await notifyReadyMadeRound(restaurantId, id, result.readyRound);

      res.status(200).json(successResponse(result, { message: 'Items added to order' }));
    } catch (error) {
      next(error);
    }
  }
  
  async kotPending(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) throw new Error('User not associated with a restaurant');
      res.json(successResponse({ order_ids: await printingService.listPendingKotOrders(restaurantId) }));
    } catch (error) {
      next(error);
    }
  }

  async kotClaim(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) throw new Error('User not associated with a restaurant');
      res.json(successResponse({ kot: await printingService.claimKotForDevice(req.params.id, restaurantId) }));
    } catch (error) {
      next(error);
    }
  }

  async kotRelease(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) throw new Error('User not associated with a restaurant');
      const { item_ids } = MarkKotPrintedSchema.parse(req.body);
      await printingService.releaseKot(req.params.id, restaurantId, item_ids);
      res.json(successResponse({ released: true }));
    } catch (error) {
      next(error);
    }
  }

  async markKotPrinted(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) throw new Error('User not associated with a restaurant');

      const { id } = req.params;
      const payload = MarkKotPrintedSchema.parse(req.body);
      await ordersService.markKotPrinted(id, restaurantId, payload.item_ids);

      res.status(200).json(successResponse({ marked: true }));
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /orders/:id/serve
   * Waiter confirms the food was served (optionally only one round).
   */
  async serve(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) throw new Error('User not associated with a restaurant');

      const { id } = req.params;
      await assertOrderAccess(req.user, id);
      const { round } = ServeOrderSchema.parse(req.body || {});
      const { served, order } = await ordersService.serveOrder(id, restaurantId, round);

      eventBroadcaster?.broadcastOrderUpdated({
        order_id: order.id,
        restaurant_id: restaurantId,
        status: order.status,
        total_amount: Number(order.total_amount),
        table_id: order.table_id,
      });

      res.status(200).json(successResponse({ served }, { message: 'Marked as served' }));
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) throw new Error('User not associated with a restaurant');

      const { id } = req.params;
      await assertOrderAccess(req.user, id);
      const payload = UpdateOrderRequestSchema.parse(req.body) as UpdateOrderRequest;
      const order = await ordersService.updateOrder(id, restaurantId, payload);

      // An order that waited for acceptance (QR / online) gets its KOT when the restaurant accepts it
      if (order.status === 'ACCEPTED' || order.status === 'PREPARING') {
        await printingService.enqueueUnprintedKot(order.id, restaurantId)
          .catch((err) => console.error('[PrintBridge] KOT enqueue failed:', err?.message || err));
      }

      // Broadcast the right event based on new status
      const broadcastPayload = {
        order_id: order.id,
        restaurant_id: restaurantId,
        status: order.status,
        total_amount: Number(order.total_amount),
        table_id: order.table_id,
        order_number: order.order_number,
      };

      if (order.status === 'COMPLETED') {
        eventBroadcaster?.broadcastOrderCompleted(broadcastPayload);
        clearDelayAlert(order.id);   // remove from delay alert cache
      } else if (order.status === 'CANCELLED') {
        eventBroadcaster?.broadcastOrderCancelled(broadcastPayload);
        clearDelayAlert(order.id);   // remove from delay alert cache
      } else {
        eventBroadcaster?.broadcastOrderUpdated(broadcastPayload);
      }

      res.status(200).json(successResponse(order, { message: 'Order updated successfully' }));
    } catch (error) {
      next(error);
    }
  }

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) throw new Error('User not associated with a restaurant');

      const { id } = req.params;
      await ordersService.deleteOrder(id, restaurantId);

      eventBroadcaster?.broadcastOrderDeleted({
        order_id: id,
        restaurant_id: restaurantId,
        status: 'CANCELLED',
      });

      res.status(200).json(successResponse({ message: 'Order deleted successfully' }));
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

      const stats = await ordersService.getOrderStats(restaurantId);
      res.status(200).json(successResponse(stats));
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /orders/:id/items/:itemId
   * Update the status of a single order item (PENDING → PREPARING → DONE).
   * Used by kitchen staff to tick off individual dishes as they're prepared.
   *
   * When all items are marked DONE, the order is automatically advanced to READY.
   */
  async updateItemStatus(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const restaurantId = req.user?.restaurantId;
      if (!restaurantId) throw new Error('User not associated with a restaurant');

      const { id: orderId, itemId } = req.params;
      await assertOrderAccess(req.user, orderId);
      const { status, cancel_quantity } = UpdateOrderItemStatusSchema.parse(req.body);

      const result = await ordersService.updateItemStatus(orderId, itemId, restaurantId, status, cancel_quantity);

      // A cancelled line item changes the bill total; notify all connected screens.
      if (status === 'CANCELLED' && result.order) {
        const payload = { order_id: result.order.id, restaurant_id: restaurantId, status: result.order.status, total_amount: Number(result.order.total_amount), table_id: result.order.table_id, order_number: result.order.order_number };
        if (result.order.status === 'CANCELLED') eventBroadcaster?.broadcastOrderCancelled(payload);
        else eventBroadcaster?.broadcastOrderUpdated(payload);
        if (result.order.status === 'CANCELLED') clearDelayAlert(result.order.id);
      }

      // If all items are done, the order was auto-advanced to READY — broadcast it
      if (result.orderAutoAdvanced && result.order) {
        eventBroadcaster?.broadcastOrderUpdated({
          order_id: result.order.id,
          restaurant_id: restaurantId,
          status: result.order.status,
          total_amount: Number(result.order.total_amount),
          table_id: result.order.table_id,
        });
      }

      // Kitchen finished a whole round -> alert the waiters (live + push for locked screens)
      if (result.roundReady) {
        const label = result.roundReady.table_number ? `Table ${result.roundReady.table_number}` : `Order ${result.roundReady.order_number}`;
        eventBroadcaster?.broadcastRoundReady({
          order_id: orderId,
          restaurant_id: restaurantId,
          order_number: result.roundReady.order_number,
          table_number: result.roundReady.table_number,
          round: result.roundReady.round,
        });
        pushService
          .sendToRestaurant(restaurantId, {
            title: `${label} — order ready`,
            body: `Round ${result.roundReady.round} of ${result.roundReady.order_number} is ready to serve`,
            tag: `ready-${orderId}-${result.roundReady.round}`,
            data: { url: '/orders' },
          }, ['WAITER', 'RECEPTION'])
          .catch(() => {});
      }

      res.status(200).json(
        successResponse(
          { item: result.item, order_auto_advanced: result.orderAutoAdvanced },
          {
            message: status === 'CANCELLED' ? 'Item cancelled; remaining order updated' : result.orderAutoAdvanced
              ? 'All items done — order marked READY'
              : 'Item status updated',
          },
        ),
      );
    } catch (error) {
      next(error);
    }
  }
}

export const ordersController = new OrdersController();
