import { query } from '@/config/database';
import { MenuCategory, MenuItem, MenuStats } from './menu.types';

export class MenuRepository {
  /** How many of these ids belong to the restaurant (categories or items). */
  async countOwned(table: 'menu_categories' | 'menu_items', restaurantId: string, ids: string[]): Promise<number> {
    const result = await query(
      `SELECT COUNT(*)::int AS n FROM ${table} WHERE restaurant_id = $1 AND id::text = ANY($2::text[])`,
      [restaurantId, ids]
    );
    return result.rows[0].n;
  }

  /** Sets display_order = 1..n following the order of `ids`, in one statement. */
  async reorder(table: 'menu_categories' | 'menu_items', restaurantId: string, ids: string[]): Promise<void> {
    await query(
      `UPDATE ${table} t
          SET display_order = v.ord::int, updated_at = NOW()
         FROM unnest($2::text[]) WITH ORDINALITY AS v(id, ord)
        WHERE t.id::text = v.id AND t.restaurant_id = $1`,
      [restaurantId, ids]
    );
  }

  async createCategory(
    restaurantId: string,
    name: string,
    description: string | null,
    displayOrder: number,
    isActive: boolean,
    showToCustomers: boolean = true
  ): Promise<MenuCategory> {
    const result = await query(
      `INSERT INTO menu_categories (restaurant_id, name, description, display_order, is_active, show_to_customers)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, restaurant_id, name, description, display_order, is_active, show_to_customers, created_at, updated_at`,
      [restaurantId, name, description, displayOrder, isActive, showToCustomers]
    );
    return result.rows[0];
  }

  async findCategoryById(categoryId: string): Promise<MenuCategory | null> {
    const result = await query(
      'SELECT id, restaurant_id, name, description, display_order, is_active, show_to_customers, created_at, updated_at FROM menu_categories WHERE id = $1 LIMIT 1',
      [categoryId]
    );
    return result.rows[0] || null;
  }

  async findCategoriesByRestaurantId(restaurantId: string): Promise<MenuCategory[]> {
    const result = await query(
      'SELECT id, restaurant_id, name, description, display_order, is_active, show_to_customers, created_at, updated_at FROM menu_categories WHERE restaurant_id = $1 ORDER BY display_order ASC, name ASC',
      [restaurantId]
    );
    return result.rows;
  }

  async updateCategory(
    categoryId: string,
    updates: Partial<{
      name: string;
      description: string | null;
      display_order: number;
      is_active: boolean;
      show_to_customers: boolean;
    }>
  ): Promise<MenuCategory | null> {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }
    if (updates.display_order !== undefined) {
      fields.push(`display_order = $${paramIndex++}`);
      values.push(updates.display_order);
    }
    if (updates.is_active !== undefined) {
      fields.push(`is_active = $${paramIndex++}`);
      values.push(updates.is_active);
    }
    if (updates.show_to_customers !== undefined) {
      fields.push(`show_to_customers = $${paramIndex++}`);
      values.push(updates.show_to_customers);
    }

    if (fields.length === 0) {
      return this.findCategoryById(categoryId);
    }

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(categoryId);

    const result = await query(
      `UPDATE menu_categories SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING id, restaurant_id, name, description, display_order, is_active, show_to_customers, created_at, updated_at`,
      values
    );

    return result.rows[0] || null;
  }

  async deleteCategory(categoryId: string): Promise<boolean> {
    // Items whose MAIN category is this one but that also live in another category
    // move their main category over, so deleting this category doesn't delete them.
    // (Items that are only in this category are removed, as before.)
    await query(
      `UPDATE menu_items mi
          SET category_id = (
                SELECT mic.category_id FROM menu_item_categories mic
                 WHERE mic.menu_item_id = mi.id AND mic.category_id <> $1
                 ORDER BY mic.created_at, mic.category_id LIMIT 1)
        WHERE mi.category_id = $1
          AND EXISTS (SELECT 1 FROM menu_item_categories mic
                       WHERE mic.menu_item_id = mi.id AND mic.category_id <> $1)`,
      [categoryId]
    );
    const result = await query('DELETE FROM menu_categories WHERE id = $1', [categoryId]);
    return (result.rowCount ?? 0) > 0;
  }

  async categoryNameExists(restaurantId: string, name: string, excludeId?: string): Promise<boolean> {
    let queryText = 'SELECT 1 FROM menu_categories WHERE restaurant_id = $1 AND LOWER(name) = LOWER($2)';
    const params: any[] = [restaurantId, name];

    if (excludeId) {
      queryText += ' AND id != $3';
      params.push(excludeId);
    }

    queryText += ' LIMIT 1';
    const result = await query(queryText, params);
    return result.rows.length > 0;
  }

  async createMenuItem(
    restaurantId: string,
    categoryId: string,
    name: string,
    description: string | null,
    price: number,
    prepTimeMinutes: number,
    isVegetarian: boolean,
    isActive: boolean,
    displayOrder: number,
    imageUrl: string | null = null,
    isFeatured: boolean = false,
    priceUnit: 'PIECE' | 'KG' | '100G' = 'PIECE',
    skipKitchen: boolean = false,
    readyInStock: boolean = true
  ): Promise<MenuItem> {
    const result = await query(
      `INSERT INTO menu_items (restaurant_id, category_id, name, description, price, prep_time_minutes, is_vegetarian, is_active, display_order, image_url, is_featured, price_unit, skip_kitchen, ready_in_stock)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id, restaurant_id, category_id, name, description, price, prep_time_minutes, is_vegetarian, price_unit, image_url, is_featured, skip_kitchen, ready_in_stock, is_active, display_order, created_at, updated_at`,
      [restaurantId, categoryId, name, description, price, prepTimeMinutes, isVegetarian, isActive, displayOrder, imageUrl, isFeatured, priceUnit, skipKitchen, readyInStock]
    );
    const created: MenuItem = result.rows[0];
    created.category_ids = [created.category_id];
    return created;
  }

  /** Adds `category_ids` (every category the item is listed under) to each item. */
  async attachCategoryIds<T extends { id: string; category_id: string }>(items: T[]): Promise<(T & { category_ids: string[] })[]> {
    if (items.length === 0) return [];
    const result = await query(
      `SELECT menu_item_id, category_id FROM menu_item_categories
        WHERE menu_item_id = ANY($1::uuid[])
        ORDER BY created_at, category_id`,
      [items.map((i) => i.id)]
    );
    const byItem = new Map<string, string[]>();
    for (const row of result.rows) {
      const list = byItem.get(row.menu_item_id) ?? [];
      list.push(row.category_id);
      byItem.set(row.menu_item_id, list);
    }
    return items.map((item) => {
      const ids = byItem.get(item.id) ?? [];
      // main category first; fall back to it if the link table has nothing yet
      const ordered = [item.category_id, ...ids.filter((id) => id !== item.category_id)];
      return { ...item, category_ids: ordered };
    });
  }

  /** Replaces the item's category links. The first id becomes the main category. */
  async setItemCategories(menuItemId: string, restaurantId: string, categoryIds: string[]): Promise<void> {
    await query(
      `DELETE FROM menu_item_categories WHERE menu_item_id = $1 AND category_id <> ALL($2::uuid[])`,
      [menuItemId, categoryIds]
    );
    await query(
      `INSERT INTO menu_item_categories (menu_item_id, category_id, restaurant_id)
       SELECT $1, c, $3 FROM unnest($2::uuid[]) AS c
       ON CONFLICT DO NOTHING`,
      [menuItemId, categoryIds, restaurantId]
    );
    await query(`UPDATE menu_items SET category_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [menuItemId, categoryIds[0]]);
  }

  /** True when at least one category of the item is switched on AND shown to customers. */
  async isItemVisibleToCustomers(menuItemId: string): Promise<boolean> {
    const result = await query(
      `SELECT 1
         FROM menu_item_categories mic
         JOIN menu_categories c ON c.id = mic.category_id
        WHERE mic.menu_item_id = $1 AND c.is_active = TRUE AND c.show_to_customers = TRUE
        LIMIT 1`,
      [menuItemId]
    );
    return result.rows.length > 0;
  }

  async findMenuItemById(menuItemId: string): Promise<MenuItem | null> {
    const result = await query(
      'SELECT id, restaurant_id, category_id, name, description, price, prep_time_minutes, is_vegetarian, price_unit, image_url, is_featured, skip_kitchen, ready_in_stock, is_active, display_order, created_at, updated_at FROM menu_items WHERE id = $1 LIMIT 1',
      [menuItemId]
    );
    if (!result.rows[0]) return null;
    return (await this.attachCategoryIds([result.rows[0]]))[0] as MenuItem;
  }

  async findMenuItemsByRestaurantId(restaurantId: string): Promise<MenuItem[]> {
    const result = await query(
      'SELECT id, restaurant_id, category_id, name, description, price, prep_time_minutes, is_vegetarian, price_unit, image_url, is_featured, skip_kitchen, ready_in_stock, is_active, display_order, created_at, updated_at FROM menu_items WHERE restaurant_id = $1 ORDER BY display_order ASC, name ASC',
      [restaurantId]
    );
    return (await this.attachCategoryIds(result.rows)) as MenuItem[];
  }

  /** Active items that sit in at least one switched-on category shown to customers (WhatsApp, etc.). */
  async findCustomerVisibleMenuItems(restaurantId: string): Promise<MenuItem[]> {
    const [categories, items] = await Promise.all([
      this.findCategoriesByRestaurantId(restaurantId),
      this.findMenuItemsByRestaurantId(restaurantId),
    ]);
    const visible = new Set(categories.filter((c) => c.is_active && c.show_to_customers).map((c) => c.id));
    return items.filter((i) => i.is_active && i.category_ids.some((id) => visible.has(id)));
  }

  async findMenuItemsByCategoryId(categoryId: string): Promise<MenuItem[]> {
    const result = await query(
      'SELECT id, restaurant_id, category_id, name, description, price, prep_time_minutes, is_vegetarian, price_unit, image_url, is_featured, skip_kitchen, ready_in_stock, is_active, display_order, created_at, updated_at FROM menu_items WHERE id IN (SELECT menu_item_id FROM menu_item_categories WHERE category_id = $1) ORDER BY display_order ASC, name ASC',
      [categoryId]
    );
    return (await this.attachCategoryIds(result.rows)) as MenuItem[];
  }

  async updateMenuItem(
    menuItemId: string,
    updates: Partial<{
      category_id: string;
      name: string;
      description: string | null;
      price: number;
      prep_time_minutes: number;
      is_vegetarian: boolean;
      is_active: boolean;
      display_order: number;
      image_url: string | null;
      is_featured: boolean;
      skip_kitchen: boolean;
      ready_in_stock: boolean;
      price_unit: 'PIECE' | 'KG' | '100G';
    }>
  ): Promise<MenuItem | null> {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    if (updates.category_id !== undefined) {
      fields.push(`category_id = $${paramIndex++}`);
      values.push(updates.category_id);
    }
    if (updates.name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }
    if (updates.price !== undefined) {
      fields.push(`price = $${paramIndex++}`);
      values.push(updates.price);
    }
    if (updates.prep_time_minutes !== undefined) {
      fields.push(`prep_time_minutes = $${paramIndex++}`);
      values.push(updates.prep_time_minutes);
    }
    if (updates.is_vegetarian !== undefined) {
      fields.push(`is_vegetarian = $${paramIndex++}`);
      values.push(updates.is_vegetarian);
    }
    if (updates.is_active !== undefined) {
      fields.push(`is_active = $${paramIndex++}`);
      values.push(updates.is_active);
    }
    if (updates.display_order !== undefined) {
      fields.push(`display_order = $${paramIndex++}`);
      values.push(updates.display_order);
    }
    if (updates.image_url !== undefined) {
      fields.push(`image_url = $${paramIndex++}`);
      values.push(updates.image_url);
    }
    if (updates.is_featured !== undefined) {
      fields.push(`is_featured = $${paramIndex++}`);
      values.push(updates.is_featured);
    }
    if (updates.skip_kitchen !== undefined) {
      fields.push(`skip_kitchen = $${paramIndex++}`);
      values.push(updates.skip_kitchen);
    }
    if (updates.ready_in_stock !== undefined) {
      fields.push(`ready_in_stock = $${paramIndex++}`);
      values.push(updates.ready_in_stock);
    }
    if (updates.price_unit !== undefined) {
      fields.push(`price_unit = $${paramIndex++}`);
      values.push(updates.price_unit);
    }

    if (fields.length === 0) {
      return this.findMenuItemById(menuItemId);
    }

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(menuItemId);

    const result = await query(
      `UPDATE menu_items SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING id, restaurant_id, category_id, name, description, price, prep_time_minutes, is_vegetarian, price_unit, image_url, is_featured, skip_kitchen, ready_in_stock, is_active, display_order, created_at, updated_at`,
      values
    );

    if (!result.rows[0]) return null;
    return (await this.attachCategoryIds([result.rows[0]]))[0] as MenuItem;
  }

  async deleteMenuItem(menuItemId: string): Promise<boolean> {
    const result = await query('DELETE FROM menu_items WHERE id = $1', [menuItemId]);
    return (result.rowCount ?? 0) > 0;
  }

  async menuItemNameExists(restaurantId: string, name: string, excludeId?: string): Promise<boolean> {
    let queryText = 'SELECT 1 FROM menu_items WHERE restaurant_id = $1 AND LOWER(name) = LOWER($2)';
    const params: any[] = [restaurantId, name];

    if (excludeId) {
      queryText += ' AND id != $3';
      params.push(excludeId);
    }

    queryText += ' LIMIT 1';
    const result = await query(queryText, params);
    return result.rows.length > 0;
  }

  async getMenuStats(restaurantId: string): Promise<MenuStats> {
    const result = await query(
      `SELECT
        COUNT(DISTINCT c.id) as total_categories,
        COUNT(DISTINCT CASE WHEN c.is_active THEN c.id END) as active_categories,
        COUNT(DISTINCT i.id) as total_items,
        COUNT(DISTINCT CASE WHEN i.is_active THEN i.id END) as active_items
       FROM menu_categories c
       LEFT JOIN menu_item_categories mic ON mic.category_id = c.id
       LEFT JOIN menu_items i ON i.id = mic.menu_item_id
       WHERE c.restaurant_id = $1`,
      [restaurantId]
    );

    const stats = result.rows[0];
    return {
      total_categories: parseInt(stats.total_categories) || 0,
      active_categories: parseInt(stats.active_categories) || 0,
      total_items: parseInt(stats.total_items) || 0,
      active_items: parseInt(stats.active_items) || 0,
    };
  }
}

export const menuRepository = new MenuRepository();