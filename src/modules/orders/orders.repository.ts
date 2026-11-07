import { pool, query } from '@/config/database';
import { Order, OrderItem, OrderStats, EnrichedOrder, UpdatedOrderItem } from './orders.types';
import { isToday } from '@/shared/businessTime';
import { BadRequestError, NotFoundError } from '@/shared/errors/AppError';

export class OrdersRepository {
  async createOrderWithItems(
    restaurantId: string,
    tableId: string | null,
    orderNumber: string,
    orderType: string,
    orderSource: string,
    totalAmount: number,
    priorityScore: number,
    specialInstructions: string | null,
    createdBy: string | null,
    items: Array<{
      menu_item_id: string;
      quantity: number;
      unit_price: number;
      special_instructions: string | null;
      status: string;
      weight_grams?: number | null;
    }>,
    initialStatus: string = 'CREATED',
    tokenNumber: string | null = null,
    guestLabel: string | null = null,
  ): Promise<{ order: Order; items: OrderItem[] }> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const orderResult = await client.query(
        `INSERT INTO orders (restaurant_id, table_id, order_number, token_number, order_type, order_source, status, total_amount, priority_score, special_instructions, created_by, guest_label)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id, restaurant_id, table_id, guest_label, order_number, token_number, order_type, order_source, status, total_amount, priority_score, special_instructions, created_by, created_at, updated_at, completed_at`,
        [
          restaurantId,
          tableId,
          orderNumber,
          tokenNumber,
          orderType,
          orderSource,
          initialStatus,
          totalAmount,
          priorityScore,
          specialInstructions,
          createdBy,
          guestLabel,
        ],
      );

      const order = orderResult.rows[0];
      const itemValues: any[] = [];
      const placeholders: string[] = [];
      let paramIndex = 1;

      // A brand-new order is always "round 1" — the first ticket that goes to the kitchen.
      items.forEach((item) => {
        placeholders.push(
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, 1)`,
        );
        itemValues.push(
          order.id,
          restaurantId,
          item.menu_item_id,
          item.quantity,
          item.unit_price,
          item.special_instructions,
          item.status,
          item.weight_grams ?? null,
        );
      });

      const itemsResult = await client.query(
        `INSERT INTO order_items (order_id, restaurant_id, menu_item_id, quantity, unit_price, special_instructions, status, weight_grams, round)
         VALUES ${placeholders.join(", ")}
         RETURNING id, order_id, restaurant_id, menu_item_id, quantity, unit_price, special_instructions, status, weight_grams, round, created_at, updated_at`,
        itemValues,
      );

      await client.query("COMMIT");
      return { order, items: itemsResult.rows };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findById(orderId: string): Promise<Order | null> {
    const result = await query(
      "SELECT id, restaurant_id, table_id, order_number, token_number, order_type, order_source, status, total_amount, priority_score, special_instructions, created_by, created_at, updated_at, completed_at FROM orders WHERE id = $1 LIMIT 1",
      [orderId],
    );
    return result.rows[0] || null;
  }

  /**
   * Find a single order fully enriched with table info and line items
   * (each item includes the resolved menu_item_name). Matches the shape
   * returned by the list endpoint so the frontend can render consistently.
   */
  async findByIdWithDetails(orderId: string): Promise<EnrichedOrder | null> {
    const result = await query(
      `
      SELECT
        o.id, o.restaurant_id, o.table_id, o.guest_label, o.order_number, o.order_type,
        o.order_source, o.status, o.total_amount, o.priority_score,
        o.special_instructions, o.created_by, o.created_at, o.updated_at, o.completed_at,
        rt.id AS table_join_id,
        rt.table_number,
        COALESCE(
          json_agg(
            json_build_object(
              'id', oi.id,
              'order_id', oi.order_id,
              'restaurant_id', oi.restaurant_id,
              'menu_item_id', oi.menu_item_id,
              'menu_item_name', mi.name,
              'weight_grams', oi.weight_grams,
              'quantity', oi.quantity,
              'unit_price', oi.unit_price,
              'special_instructions', oi.special_instructions,
              'status', oi.status,
              'kot_printed_at', oi.kot_printed_at,
              'round', oi.round,
              'served_at', oi.served_at,
              'created_at', oi.created_at AT TIME ZONE 'UTC',
              'modifiers', (
                SELECT COALESCE(
                  json_agg(
                    json_build_object(
                      'modifier_group_name', oim.modifier_group_name,
                      'modifier_option_name', oim.modifier_option_name,
                      'price_adjustment', oim.price_adjustment
                    )
                    ORDER BY oim.created_at ASC
                  ) FILTER (WHERE oim.id IS NOT NULL),
                  '[]'::json
                )
                FROM order_item_modifiers oim
                WHERE oim.order_item_id = oi.id
              )
            )
            ORDER BY oi.created_at ASC
          ) FILTER (WHERE oi.id IS NOT NULL),
          '[]'
        ) AS order_items
      FROM orders o
      LEFT JOIN restaurant_tables rt ON o.table_id = rt.id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
      WHERE o.id = $1
      GROUP BY o.id, rt.id
      `,
      [orderId],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      ...row,
      table: row.table_number
        ? { id: row.table_join_id, table_number: row.table_number }
        : null,
      order_items: row.order_items || [],
      items: row.order_items || [],
    };
  }

  /**
   * Find the most recent active (open) order for a table.
   * Active = not COMPLETED and not CANCELLED.
   */
  async findActiveByTableId(restaurantId: string, tableId: string): Promise<Order | null> {
    const result = await query(
      `SELECT id, restaurant_id, table_id, order_number, token_number, order_type, order_source, status, total_amount, priority_score, special_instructions, created_by, created_at, updated_at, completed_at
       FROM orders
       WHERE restaurant_id = $1
         AND table_id = $2
         AND status NOT IN ('COMPLETED', 'CANCELLED')
       ORDER BY created_at DESC
       LIMIT 1`,
      [restaurantId, tableId],
    );
    return result.rows[0] || null;
  }

  /**
   * Add items to an existing order inside a transaction and recompute the total.
   *
   * Every call to this function is its own "round" — a distinct trip to the
   * kitchen. Items are always inserted as new rows tagged with the next round
   * number (never merged into an earlier round's line), so each round stays
   * visually and physically separate (its own KOT), even though they all
   * belong to the same order/bill until payment is collected.
   */
  async addItemsToOrder(
    orderId: string,
    restaurantId: string,
    items: Array<{
      menu_item_id: string;
      quantity: number;
      unit_price: number;
      special_instructions: string | null;
      status: string;
      weight_grams?: number | null;
    }>,
  ): Promise<{ order: Order; items: OrderItem[] }> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Lock the order row so that concurrent createPaymentAtomic calls on the
      // same order block until this transaction commits.  Without this lock a
      // payment could read total_amount before the new items are added, then
      // validate and insert against a stale (lower) total.
      await client.query(
        `SELECT id FROM orders WHERE id = $1 FOR UPDATE`,
        [orderId],
      );

      // Work out the next round number for this order (1 if somehow none exist yet).
      const roundResult = await client.query(
        `SELECT COALESCE(MAX(round), 0) + 1 AS next_round FROM order_items WHERE order_id = $1`,
        [orderId],
      );
      const nextRound: number = roundResult.rows[0].next_round;

      for (const item of items) {
        await client.query(
          `INSERT INTO order_items (order_id, restaurant_id, menu_item_id, quantity, unit_price, special_instructions, status, round, weight_grams)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            orderId,
            restaurantId,
            item.menu_item_id,
            item.quantity,
            item.unit_price,
            item.special_instructions,
            item.status,
            nextRound,
            item.weight_grams ?? null,
          ],
        );
      }

      // A new round means the kitchen has work again: if the order was already
      // READY (waiting for the waiter/payment), send it back to ACCEPTED so it
      // reappears on the kitchen display.
      await client.query(
        `UPDATE orders SET status = 'ACCEPTED', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'READY'`,
        [orderId],
      );

      // Recompute total from all line items
      await client.query(
        `UPDATE orders
         SET total_amount = (
           SELECT COALESCE(SUM(quantity * unit_price), 0)
           FROM order_items WHERE order_id = $1 AND status <> 'CANCELLED'
         ),
         updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [orderId],
      );

      const orderResult = await client.query(
        `SELECT id, restaurant_id, table_id, order_number, token_number, order_type, order_source, status, total_amount, priority_score, special_instructions, created_by, created_at, updated_at, completed_at
         FROM orders WHERE id = $1`,
        [orderId],
      );

      const itemsResult = await client.query(
        `SELECT id, order_id, restaurant_id, menu_item_id, quantity, unit_price, special_instructions, status, kot_printed_at, round, created_at, updated_at
         FROM order_items WHERE order_id = $1 ORDER BY created_at ASC`,
        [orderId],
      );

      await client.query("COMMIT");
      return { order: orderResult.rows[0], items: itemsResult.rows };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findItemsByOrderId(orderId: string): Promise<OrderItem[]> {
    const result = await query(
      "SELECT id, order_id, restaurant_id, menu_item_id, quantity, unit_price, special_instructions, status, kot_printed_at, round, created_at, updated_at FROM order_items WHERE order_id = $1 ORDER BY created_at ASC",
      [orderId],
    );
    return result.rows;
  }

  /**
   * Mark items as sent to the kitchen printer — used so a later top-up on
   * the same bill only reprints the items that haven't gone out yet.
   */
  async markItemsKotPrinted(orderId: string, restaurantId: string, itemIds: string[]): Promise<void> {
    if (itemIds.length === 0) return;
    await query(
      `UPDATE order_items
       SET kot_printed_at = CURRENT_TIMESTAMP
       WHERE order_id = $1 AND restaurant_id = $2 AND id = ANY($3::uuid[])`,
      [orderId, restaurantId, itemIds],
    );
  }

  async findByRestaurantId(
    restaurantId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<EnrichedOrder[]> {
    const result = await query(
      `
    SELECT
      o.id,
      o.restaurant_id,
      o.table_id,
      o.guest_label,
      o.order_number,
      o.order_type,
      o.order_source,
      o.status,
      o.total_amount,
      o.priority_score,
      o.special_instructions,
      o.created_by,
      o.created_at,
      o.updated_at,
      o.completed_at,

      rt.id AS table_join_id,
      rt.table_number,

      COALESCE(
        json_agg(
          json_build_object(
            'id', oi.id,
            'order_id', oi.order_id,
            'restaurant_id', oi.restaurant_id,
            'menu_item_id', oi.menu_item_id,
            'menu_item_name', mi.name,
            'weight_grams', oi.weight_grams,
            'quantity', oi.quantity,
            'unit_price', oi.unit_price,
            'special_instructions', oi.special_instructions,
            'status', oi.status,
            'kot_printed_at', oi.kot_printed_at,
            'round', oi.round,
              'served_at', oi.served_at,
              'created_at', oi.created_at AT TIME ZONE 'UTC'
          )
        ) FILTER (WHERE oi.id IS NOT NULL),
        '[]'
      ) AS order_items

    FROM orders o

    LEFT JOIN restaurant_tables rt
      ON o.table_id = rt.id

    LEFT JOIN order_items oi
      ON oi.order_id = o.id

    LEFT JOIN menu_items mi
      ON mi.id = oi.menu_item_id

    WHERE o.restaurant_id = $1

    GROUP BY o.id, rt.id

    ORDER BY o.created_at DESC

    LIMIT $2 OFFSET $3
    `,
      [restaurantId, limit, offset],
    );

    return result.rows.map((row) => ({
      ...row,

      table: row.table_number
        ? {
            id: row.table_join_id,
            table_number: row.table_number,
          }
        : null,

      order_items: row.order_items || [],
    }));
  }

  /**
   * Count orders for a restaurant, with optional status filter.
   * Used to return pagination metadata (total count).
   */
  async countByRestaurantId(
    restaurantId: string,
    statusFilter?: string,
    tableIds?: string[] | null,
  ): Promise<number> {
    const conditions = ['restaurant_id = $1'];
    const params: any[] = [restaurantId];

    if (tableIds) {
      params.push(tableIds);
      conditions.push(`table_id = ANY($${params.length}::uuid[])`);
    }

    if (statusFilter) {
      params.push(statusFilter);
      conditions.push(`status = $${params.length}`);
    }

    const result = await query(
      `SELECT COUNT(*)::int AS total FROM orders WHERE ${conditions.join(' AND ')}`,
      params,
    );
    return result.rows[0].total;
  }

  async findByRestaurantIdFiltered(
    restaurantId: string,
    limit: number,
    offset: number,
    statusFilter?: string,
    sortBy: string = 'created_at',
    sortOrder: string = 'DESC',
    tableIds?: string[] | null,
  ): Promise<EnrichedOrder[]> {
    const allowedSorts: Record<string, string> = {
      created_at: 'o.created_at',
      total_amount: 'o.total_amount',
      status: 'o.status',
      order_number: 'o.order_number',
    };
    const sortCol = allowedSorts[sortBy] || 'o.created_at';
    const dir = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const conditions = ['o.restaurant_id = $1'];
    const params: any[] = [restaurantId];

    if (tableIds) {
      params.push(tableIds);
      conditions.push(`o.table_id = ANY($${params.length}::uuid[])`);
    }

    if (statusFilter) {
      params.push(statusFilter);
      conditions.push(`o.status = $${params.length}`);
    }

    params.push(limit, offset);

    const result = await query(
      `
      SELECT
        o.id, o.restaurant_id, o.table_id, o.guest_label, o.order_number, o.order_type,
        o.order_source, o.status, o.total_amount, o.priority_score,
        o.special_instructions, o.created_by, o.created_at, o.updated_at, o.completed_at,
        rt.id AS table_join_id, rt.table_number,
        COALESCE(
          json_agg(
            json_build_object(
              'id', oi.id, 'order_id', oi.order_id, 'restaurant_id', oi.restaurant_id,
              'menu_item_id', oi.menu_item_id, 'menu_item_name', mi.name, 'weight_grams', oi.weight_grams, 'quantity', oi.quantity,
              'unit_price', oi.unit_price, 'special_instructions', oi.special_instructions,
              'status', oi.status, 'kot_printed_at', oi.kot_printed_at, 'round', oi.round,
              'served_at', oi.served_at,
              'created_at', oi.created_at AT TIME ZONE 'UTC'
            )
          ) FILTER (WHERE oi.id IS NOT NULL), '[]'
        ) AS order_items
      FROM orders o
      LEFT JOIN restaurant_tables rt ON o.table_id = rt.id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY o.id, rt.id
      ORDER BY ${sortCol} ${dir}
      LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params,
    );

    return result.rows.map((row) => ({
      ...row,
      table: row.table_number ? { id: row.table_join_id, table_number: row.table_number } : null,
      order_items: row.order_items || [],
    }));
  }

  async update(
    orderId: string,
    updates: Partial<{
      status: string;
      special_instructions: string | null;
      completed_at: Date | null;
    }>,
  ): Promise<Order | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.status !== undefined) {
      fields.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }
    if (updates.special_instructions !== undefined) {
      fields.push(`special_instructions = $${paramIndex++}`);
      values.push(updates.special_instructions);
    }
    if (updates.completed_at !== undefined) {
      fields.push(`completed_at = $${paramIndex++}`);
      values.push(updates.completed_at);
    }

    if (fields.length === 0) {
      return this.findById(orderId);
    }

    fields.push("updated_at = CURRENT_TIMESTAMP");
    values.push(orderId);

    const result = await query(
      `UPDATE orders SET ${fields.join(", ")} WHERE id = $${paramIndex} RETURNING id, restaurant_id, table_id, order_number, token_number, order_type, order_source, status, total_amount, priority_score, special_instructions, created_by, created_at, updated_at, completed_at`,
      values,
    );
    return result.rows[0] || null;
  }

  async delete(orderId: string): Promise<boolean> {
    const result = await query("DELETE FROM orders WHERE id = $1", [orderId]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Update the status of a single order item.
   * Returns the updated item, or null if not found.
   */
  async updateItemStatus(
    itemId: string,
    orderId: string,
    status: 'PENDING' | 'PREPARING' | 'DONE',
  ): Promise<UpdatedOrderItem | null> {
    const completedAt = status === 'DONE' ? new Date() : null;
    const result = await query(
      `UPDATE order_items
       SET status = $1, completed_at = $2, updated_at = CURRENT_TIMESTAMP,
           served_at = CASE WHEN $5::boolean THEN served_at ELSE NULL END
       WHERE id = $3 AND order_id = $4
       RETURNING id, order_id, menu_item_id, quantity, unit_price, special_instructions, status, completed_at, round, created_at, updated_at`,
      [status, completedAt, itemId, orderId, status === 'DONE'],
    );
    return result.rows[0] || null;
  }

  /** Cancel one line item while keeping the parent order open when other items remain. */
  async cancelOrderItem(
    orderId: string,
    itemId: string,
    restaurantId: string,
    cancelQuantity?: number,
  ): Promise<{ item: UpdatedOrderItem; order: Order; remainingItems: number }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const orderResult = await client.query(
        `SELECT id, restaurant_id, status FROM orders WHERE id = $1 FOR UPDATE`,
        [orderId],
      );
      const orderRow = orderResult.rows[0];
      if (!orderRow || orderRow.restaurant_id !== restaurantId) {
        throw new NotFoundError('Order not found');
      }
      if (['COMPLETED', 'CANCELLED'].includes(orderRow.status)) {
        throw new BadRequestError('Cannot cancel an item on a closed order');
      }

      const existing = await client.query(
        `SELECT quantity FROM order_items
         WHERE id = $1 AND order_id = $2 AND restaurant_id = $3 AND status <> 'CANCELLED'
         FOR UPDATE`,
        [itemId, orderId, restaurantId],
      );
      if (!existing.rows[0]) {
        throw new NotFoundError('Order item not found or already cancelled');
      }
      const currentQty: number = existing.rows[0].quantity;
      const qtyToCancel = cancelQuantity ?? currentQty;
      if (qtyToCancel > currentQty) {
        throw new BadRequestError(`Cannot cancel ${qtyToCancel}; only ${currentQty} on this item`);
      }

      const itemCols = 'id, order_id, menu_item_id, quantity, unit_price, special_instructions, status, completed_at, round, created_at, updated_at';
      let cancelledItem: UpdatedOrderItem;

      if (qtyToCancel < currentQty) {
        // Partial cancel: keep the remaining portions on the original line and
        // move the cancelled portions onto a new CANCELLED line (keeps the audit trail).
        await client.query(
          `UPDATE order_items SET quantity = quantity - $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [itemId, qtyToCancel],
        );
        const split = await client.query(
          `INSERT INTO order_items (order_id, restaurant_id, menu_item_id, quantity, unit_price, special_instructions, status, round, weight_grams, kot_printed_at, served_at)
           SELECT order_id, restaurant_id, menu_item_id, $2, unit_price, special_instructions, 'CANCELLED', round, weight_grams, kot_printed_at, served_at
           FROM order_items WHERE id = $1
           RETURNING ${itemCols}`,
          [itemId, qtyToCancel],
        );
        cancelledItem = split.rows[0];
        await client.query(
          `INSERT INTO order_item_modifiers (order_item_id, modifier_group_id, modifier_group_name, modifier_option_id, modifier_option_name, price_adjustment)
           SELECT $2, modifier_group_id, modifier_group_name, modifier_option_id, modifier_option_name, price_adjustment
           FROM order_item_modifiers WHERE order_item_id = $1`,
          [itemId, cancelledItem.id],
        );
      } else {
        const itemResult = await client.query(
          `UPDATE order_items SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 RETURNING ${itemCols}`,
          [itemId],
        );
        cancelledItem = itemResult.rows[0];
      }

      const totals = await client.query(
        `SELECT COUNT(*) FILTER (WHERE status <> 'CANCELLED')::int AS remaining_items,
                COALESCE(SUM(quantity * unit_price) FILTER (WHERE status <> 'CANCELLED'), 0) AS total_amount
         FROM order_items WHERE order_id = $1`,
        [orderId],
      );
      const remainingItems = totals.rows[0].remaining_items;
      const nextStatus = remainingItems === 0 ? 'CANCELLED' : orderRow.status;
      const updatedOrderResult = await client.query(
        `UPDATE orders SET total_amount = $2, status = $3::order_status, updated_at = CURRENT_TIMESTAMP,
             completed_at = CASE WHEN $4::boolean THEN CURRENT_TIMESTAMP ELSE completed_at END
         WHERE id = $1
         RETURNING id, restaurant_id, table_id, order_number, token_number, order_type, order_source, status, total_amount, priority_score, special_instructions, created_by, created_at, updated_at, completed_at`,
        [orderId, totals.rows[0].total_amount, nextStatus, nextStatus === 'CANCELLED'],
      );
      await client.query('COMMIT');
      return { item: cancelledItem, order: updatedOrderResult.rows[0], remainingItems };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Info needed to tell the waiter a round is ready: order/table labels and
   * whether every item of that round is now DONE.
   */
  async getRoundReadyInfo(
    orderId: string,
    round: number,
  ): Promise<{ order_number: string; table_number: string | null; round_done: boolean } | null> {
    const result = await query(
      `SELECT o.order_number, rt.table_number,
              (SELECT COUNT(*) FILTER (WHERE oi.status != 'DONE') FROM order_items oi
                WHERE oi.order_id = o.id AND oi.round = $2 AND oi.status <> 'CANCELLED') AS pending_count
       FROM orders o
       LEFT JOIN restaurant_tables rt ON rt.id = o.table_id
       WHERE o.id = $1`,
      [orderId, round],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      order_number: row.order_number,
      table_number: row.table_number ?? null,
      round_done: parseInt(row.pending_count, 10) === 0,
    };
  }

  /**
   * Mark items as served. Only finished (DONE) items are marked unless
   * `includeUnfinished` is set (used when the order was moved to READY as a whole).
   * Optionally limited to one round. Returns how many rows were marked.
   */
  async markItemsServed(
    orderId: string,
    restaurantId: string,
    round: number | undefined,
    includeUnfinished: boolean,
  ): Promise<number> {
    const params: any[] = [orderId, restaurantId];
    let extra = '';
    if (round !== undefined) {
      params.push(round);
      extra += ` AND round = $${params.length}`;
    }
    extra += ` AND status <> 'CANCELLED'`;
    if (!includeUnfinished) extra += ` AND status = 'DONE'`;
    const result = await query(
      `UPDATE order_items SET served_at = CURRENT_TIMESTAMP
       WHERE order_id = $1 AND restaurant_id = $2 AND served_at IS NULL${extra}`,
      params,
    );
    return result.rowCount ?? 0;
  }

  /**
   * Check if all items in an order are DONE.
   * Used to auto-advance the order to READY when kitchen finishes all dishes.
   */
  async allItemsDone(orderId: string): Promise<boolean> {
    const result = await query(
      `SELECT COUNT(*) FILTER (WHERE status NOT IN ('DONE', 'CANCELLED')) AS pending_count
       FROM order_items WHERE order_id = $1 AND status <> 'CANCELLED'`,
      [orderId],
    );
    return parseInt(result.rows[0].pending_count, 10) === 0;
  }

  async getStats(restaurantId: string): Promise<OrderStats> {
    const result = await query(
      `SELECT
        COUNT(*) FILTER (WHERE ${isToday('o.created_at')}) as total_orders_today,
        COUNT(*) FILTER (WHERE o.status = 'COMPLETED' AND ${isToday('o.created_at')}) as completed_orders_today,
        COUNT(*) FILTER (WHERE o.status = 'CANCELLED' AND ${isToday('o.created_at')}) as cancelled_orders_today,
        COUNT(*) FILTER (
          WHERE o.status NOT IN ('COMPLETED', 'CANCELLED')
          AND NOW() > o.created_at + (r.delay_threshold_minutes || ' minutes')::interval
        ) as delayed_orders_count,
        (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
          WHERE p.restaurant_id = $1 AND p.status = 'PAID' AND ${isToday('p.created_at')}) as revenue_today
       FROM orders o
       JOIN restaurants r ON o.restaurant_id = r.id
       WHERE o.restaurant_id = $1`,
      [restaurantId],
    );
    const stats = result.rows[0];
    return {
      total_orders_today: parseInt(stats.total_orders_today) || 0,
      completed_orders_today: parseInt(stats.completed_orders_today) || 0,
      cancelled_orders_today: parseInt(stats.cancelled_orders_today) || 0,
      delayed_orders_count: parseInt(stats.delayed_orders_count) || 0,
      revenue_today: parseFloat(stats.revenue_today) || 0,
    };
  }
}

export const ordersRepository = new OrdersRepository();
