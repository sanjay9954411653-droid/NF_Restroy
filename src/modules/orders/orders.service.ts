import { priceOrderLine } from '@/shared/weight';
import { generateOrderNumber } from '@/shared/utils/orderNumber';
import { ordersRepository } from './orders.repository';
import { tablesRepository } from '@/modules/tables/tables.repository';
import { menuRepository } from '@/modules/menu/menu.repository';
import { paymentsRepository } from '@/modules/payments/payments.repository';
import { inventoryRepository } from '@/modules/inventory/inventory.repository';
import { restaurantsRepository } from '@/modules/restaurants/restaurants.repository';
import { pool } from '@/config/database';
import { getOrderPayableTotal } from '@/shared/billing';
import {
  Order,
  OrderItem,
  OrderStats,
  EnrichedOrder,
  UpdatedOrderItem,
  CreateOrderRequest,
  UpdateOrderRequest,
  OrderItemRequest,
} from './orders.types';
import { BadRequestError, NotFoundError } from '@/shared/errors/AppError';

export class OrdersService {
  private computePriorityScore(orderType: string, orderSource: string): number {
    const typeScore = {
      DINE_IN: 30,
      PARCEL: 20,
      ONLINE: 10,
    } as Record<string, number>;

    const sourceScore = {
      WAITER: 30,
      RECEPTION: 25,
      QR: 10,
      WHATSAPP: 15,
      ZOMATO: 15,
    } as Record<string, number>;

    return (typeScore[orderType] ?? 0) + (sourceScore[orderSource] ?? 0);
  }

  async createOrder(restaurantId: string, createdBy: string | null, payload: CreateOrderRequest): Promise<{ order: Order; items: OrderItem[] }> {
    const { table_id, order_type, order_source, special_instructions, items } = payload;

    if (order_type === 'DINE_IN' && !table_id) {
      throw new BadRequestError('Table ID is required for dine-in orders');
    }

    if (table_id) {
      const table = await tablesRepository.findById(table_id);
      if (!table || table.restaurant_id !== restaurantId) {
        throw new BadRequestError('Table does not belong to this restaurant');
      }
    }

    if (!items.length) {
      throw new BadRequestError('Order must include at least one item');
    }

    const groupedItems = this.groupOrderItems(items);
    const orderItems = await Promise.all(groupedItems.map(async (item) => this.buildOrderItem(restaurantId, item)));

    const totalAmount = orderItems.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
    const priorityScore = this.computePriorityScore(order_type, order_source);
    const orderNumber = await generateOrderNumber(restaurantId);

    const staffSources = ['WAITER', 'RECEPTION'];
    const initialStatus = staffSources.includes(order_source) ? 'ACCEPTED' : 'CREATED';

    // Generate token number if QSR mode is enabled for this restaurant
    let tokenNumber: string | null = null;
    const restaurant = await restaurantsRepository.findById(restaurantId);
    if (restaurant?.qsr_enabled) {
      const counter = await restaurantsRepository.nextTokenNumber(restaurantId);
      const seq = String(counter).padStart(3, '0');
      tokenNumber = `${restaurant.token_prefix}-${seq}`;
    }

    return ordersRepository.createOrderWithItems(
      restaurantId,
      table_id ?? null,
      orderNumber,
      order_type,
      order_source,
      totalAmount,
      priorityScore,
      special_instructions ?? null,
      createdBy,
      orderItems,
      initialStatus,
      tokenNumber,
    );
  }

  private async buildOrderItem(restaurantId: string, item: OrderItemRequest) {
    const menuItem = await menuRepository.findMenuItemById(item.menu_item_id);
    if (!menuItem || menuItem.restaurant_id !== restaurantId) {
      throw new BadRequestError('Menu item does not belong to this restaurant');
    }

    // By-weight items (price per kg / per 100 g) are priced here from the weight;
    // normal items use the menu price. Never taken from the client.
    const priced = priceOrderLine(menuItem, item);
    if ('error' in priced) {
      throw new BadRequestError(priced.error);
    }

    return {
      menu_item_id: item.menu_item_id,
      quantity: item.quantity,
      unit_price: priced.unit_price,
      special_instructions: item.special_instructions ?? null,
      weight_grams: priced.weight_grams,
      status: 'PENDING',
    };
  }

  async getOrder(orderId: string, restaurantId: string): Promise<{ order: EnrichedOrder; items: OrderItem[] }> {
    const detailed = await ordersRepository.findByIdWithDetails(orderId);
    if (!detailed || detailed.restaurant_id !== restaurantId) {
      throw new NotFoundError('Order not found');
    }

    // Return the enriched order (with table + items embedded) and the items array
    return { order: detailed, items: detailed.order_items };
  }

  /**
   * Find the active (open) order for a table, if any.
   * Used by the frontend to offer "add to existing order" instead of creating a new one.
   */
  async getActiveOrderForTable(restaurantId: string, tableId: string): Promise<{ order: Order; items: OrderItem[] } | null> {
    const order = await ordersRepository.findActiveByTableId(restaurantId, tableId);
    if (!order) return null;
    const items = await ordersRepository.findItemsByOrderId(order.id);
    return { order, items };
  }

  /**
   * Append items to an existing order (running tab).
   * The order must be open (not COMPLETED / CANCELLED).
   */
  async addItemsToOrder(orderId: string, restaurantId: string, items: OrderItemRequest[]): Promise<{ order: Order; items: OrderItem[] }> {
    const order = await ordersRepository.findById(orderId);
    if (!order || order.restaurant_id !== restaurantId) {
      throw new NotFoundError('Order not found');
    }

    if (['COMPLETED', 'CANCELLED'].includes(order.status)) {
      throw new BadRequestError('Cannot add items to a completed or cancelled order');
    }

    if (!items.length) {
      throw new BadRequestError('At least one item is required');
    }

    const grouped = this.groupOrderItems(items);
    const orderItems = await Promise.all(grouped.map((item) => this.buildOrderItem(restaurantId, item)));

    return ordersRepository.addItemsToOrder(orderId, restaurantId, orderItems);
  }
  
  /**
   * Waiter marks food as served. With `round`, only that round; otherwise everything finished.
   * If the whole order is already READY, unfinished items are marked served too.
   */
  async serveOrder(orderId: string, restaurantId: string, round?: number): Promise<{ served: number; order: Order }> {
    const order = await ordersRepository.findById(orderId);
    if (!order || order.restaurant_id !== restaurantId) {
      throw new NotFoundError('Order not found');
    }
    if (['COMPLETED', 'CANCELLED'].includes(order.status)) {
      throw new BadRequestError('Order is already closed');
    }
    const served = await ordersRepository.markItemsServed(orderId, restaurantId, round, order.status === 'READY');
    return { served, order };
  }

  /**
   * Mark a set of items as sent to the kitchen printer.
   */
  async markKotPrinted(orderId: string, restaurantId: string, itemIds: string[]): Promise<void> {
    const order = await ordersRepository.findById(orderId);
    if (!order || order.restaurant_id !== restaurantId) {
      throw new NotFoundError('Order not found');
    }
    await ordersRepository.markItemsKotPrinted(orderId, restaurantId, itemIds);
  }

  private groupOrderItems(items: CreateOrderRequest['items']): CreateOrderRequest['items'] {
    const grouped = new Map<string, CreateOrderRequest['items'][number]>; 

    let weighedLines = 0;
    for (const item of items) {
      // A weighed portion is its own line: merging two of them would add their
      // quantities and silently drop one of the weights.
      const key = item.weight_grams
        ? `${item.menu_item_id}::weighed::${weighedLines++}`
        : `${item.menu_item_id}::${item.special_instructions ?? ''}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        grouped.set(key, { ...item });
      }
    }

    return Array.from(grouped.values());
  }

  async getOrders(
    restaurantId: string,
    limit: number = 50,
    offset: number = 0,
    statusFilter?: string,
    sortBy?: string,
    sortOrder?: string,
  ): Promise<{ items: any[]; total: number }> {
    const [items, total] = await Promise.all([
      ordersRepository.findByRestaurantIdFiltered(restaurantId, limit, offset, statusFilter, sortBy, sortOrder),
      ordersRepository.countByRestaurantId(restaurantId, statusFilter),
    ]);
    return { items, total };
  }

  async updateOrder(orderId: string, restaurantId: string, payload: UpdateOrderRequest): Promise<Order> {
    const order = await ordersRepository.findById(orderId);
    if (!order || order.restaurant_id !== restaurantId) {
      throw new NotFoundError('Order not found');
    }

    const updates: any = {};
    if (payload.status !== undefined) {
      this.validateStatusTransition(order.status, payload.status);
      updates.status = payload.status;
      if (payload.status === 'COMPLETED') {
        updates.completed_at = new Date();
      }
      if (payload.status === 'CANCELLED') {
        updates.completed_at = new Date();
      }
    }

    if (payload.special_instructions !== undefined) {
      updates.special_instructions = payload.special_instructions ?? null;
    }

    const updated = await ordersRepository.update(orderId, updates);
    if (!updated) {
      throw new NotFoundError('Order not found');
    }

    // When an order is marked COMPLETED, auto-create a CASH payment for any
    // remaining unpaid balance — but ONLY if there are no PENDING payments
    // already in-flight (e.g. a Razorpay online payment waiting for webhook
    // confirmation). Creating a phantom CASH record while an online payment
    // is pending would leave the order double-paid once the webhook arrives.
    if (payload.status === 'COMPLETED') {
      const orderTotal = await getOrderPayableTotal(
        (t, p) => pool.query(t, p),
        restaurantId,
        Number(order.total_amount || 0),
        orderId,
      );
      if (orderTotal > 0) {
        const existingPayments = await paymentsRepository.findByOrderId(orderId);

        const hasPendingPayment = existingPayments.some((p) => p.status === 'PENDING');

        if (!hasPendingPayment) {
          const alreadyPaid = existingPayments
            .filter((p) => p.status === 'PAID')
            .reduce((s, p) => s + Number(p.amount), 0);
          const balance = orderTotal - alreadyPaid;

          if (balance > 0.01) {
            // Auto-record the remaining balance as CASH PAID
            const invoiceSeq = Date.now().toString().slice(-6);
            await paymentsRepository.createPayment(
              restaurantId,
              orderId,
              balance,
              'CASH',
              'PAID',
              `AUTO-${invoiceSeq}`,
            );
          }
        }
      }
    }

    return updated;
  }

  private validateStatusTransition(currentStatus: string, requestedStatus: string): void {
    const transitions: Record<string, string[]> = {
      CREATED: ['ACCEPTED', 'CANCELLED'],
      ACCEPTED: ['PREPARING', 'CANCELLED'],
      PREPARING: ['READY', 'CANCELLED'],
      READY: ['OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED'],
      OUT_FOR_DELIVERY: ['COMPLETED', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: [],
    };

    if (!transitions[currentStatus]?.includes(requestedStatus)) {
      throw new BadRequestError(`Invalid status transition from ${currentStatus} to ${requestedStatus}`);
    }
  }

  async deleteOrder(orderId: string, restaurantId: string): Promise<void> {
    const order = await ordersRepository.findById(orderId);
    if (!order || order.restaurant_id !== restaurantId) {
      throw new NotFoundError('Order not found');
    }

    const deleted = await ordersRepository.delete(orderId);
    if (!deleted) {
      throw new NotFoundError('Order not found');
    }
  }

  async getOrderStats(restaurantId: string): Promise<OrderStats> {
    return ordersRepository.getStats(restaurantId);
  }

  /**
   * Update the status of a single order item (PENDING → PREPARING → DONE).
   *
   * When all items in an order are marked DONE, the order is automatically
   * advanced to READY so the waiter knows to serve the food.
   *
   * Returns the updated item and a flag indicating if the order was auto-advanced.
   */
  async updateItemStatus(
    orderId: string,
    itemId: string,
    restaurantId: string,
    status: 'PENDING' | 'PREPARING' | 'DONE' | 'CANCELLED',
  ): Promise<{ item: UpdatedOrderItem; orderAutoAdvanced: boolean; order?: Order; roundReady?: { round: number; order_number: string; table_number: string | null } }> {
    // Verify order belongs to this restaurant
    const order = await ordersRepository.findById(orderId);
    if (!order || order.restaurant_id !== restaurantId) {
      throw new NotFoundError('Order not found');
    }

    if (['COMPLETED', 'CANCELLED'].includes(order.status)) {
      throw new BadRequestError('Cannot update items on a completed or cancelled order');
    }

    if (status === 'CANCELLED') {
      const cancelled = await ordersRepository.cancelOrderItem(orderId, itemId, restaurantId);
      return { item: cancelled.item, orderAutoAdvanced: false, order: cancelled.order };
    }

    const item = await ordersRepository.updateItemStatus(itemId, orderId, status);
    if (!item) {
      throw new NotFoundError('Order item not found');
    }

    // Decrement inventory when item is marked DONE — non-fatal if tracking not set up
    if (status === 'DONE') {
      try {
        const orderItem = await ordersRepository.findItemsByOrderId(orderId);
        const thisItem = orderItem.find((i) => i.id === itemId);
        if (thisItem) {
          await inventoryRepository.decrementStockForMenuItem(
            restaurantId,
            thisItem.menu_item_id,
            thisItem.quantity,
          );
        }
      } catch (err) {
        console.error('[Inventory] Failed to decrement stock for item', itemId, err);
      }
    }

    // If all items are now DONE and the order is still PREPARING,
    // auto-advance to READY so the waiter gets notified
    let orderAutoAdvanced = false;
    let updatedOrder: Order | undefined;

    if (status === 'DONE' && order.status === 'PREPARING') {
      const allDone = await ordersRepository.allItemsDone(orderId);
      if (allDone) {
        updatedOrder = await ordersRepository.update(orderId, { status: 'READY' }) ?? undefined;
        orderAutoAdvanced = true;
      }
    }

    // Did this tap finish a whole round? If so the waiter needs to know it's ready to serve.
    let roundReady: { round: number; order_number: string; table_number: string | null } | undefined;
    if (status === 'DONE' && item.round) {
      const info = await ordersRepository.getRoundReadyInfo(orderId, item.round);
      if (info?.round_done) {
        roundReady = { round: item.round, order_number: info.order_number, table_number: info.table_number };
      }
    }

    return { item, orderAutoAdvanced, order: updatedOrder, roundReady };
  }
}

export const ordersService = new OrdersService();
