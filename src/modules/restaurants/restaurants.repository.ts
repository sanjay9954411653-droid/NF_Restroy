import { query } from '@/config/database';
import { Restaurant, RestaurantSection, RestaurantStats, RestaurantTheme } from './restaurants.types';
import { isToday, todayLocal } from '@/shared/businessTime';

const RESTAURANT_COLS = `id, name, slug, demo_mode, auto_approve_online_orders, delay_threshold_minutes,
  qr_mode, features, gstin, tax_rate::float8 AS tax_rate, tax_inclusive,
  restaurant_type, qsr_enabled, token_prefix, token_daily_reset, token_counter,
  logo_url, hero_image_url, tagline, description, address, phone, whatsapp,
  public_email, social_links, website_published, default_landing_page,
  fssai_no, upi_id, discount_percent::float8 AS discount_percent,
  service_charge_percent::float8 AS service_charge_percent,
  other_charges_percent::float8 AS other_charges_percent,
  extra_charges_amount::float8 AS extra_charges_amount,
  show_name_in_bill, bill_social_keys, ordering_enabled,
  created_at, updated_at`;

export class RestaurantsRepository {
  async create(
    name: string,
    slug: string,
    autoApproveOnlineOrders: boolean = false,
    delayThresholdMinutes: number = 15,
  ): Promise<Restaurant> {
    const result = await query(
      `INSERT INTO restaurants (name, slug, auto_approve_online_orders, delay_threshold_minutes)
       VALUES ($1, $2, $3, $4)
       RETURNING ${RESTAURANT_COLS}`,
      [name, slug, autoApproveOnlineOrders, delayThresholdMinutes],
    );
    return result.rows[0];
  }

  async findById(restaurantId: string): Promise<Restaurant | null> {
    const result = await query(
      `SELECT ${RESTAURANT_COLS} FROM restaurants WHERE id = $1 LIMIT 1`,
      [restaurantId],
    );
    return result.rows[0] || null;
  }

  async findBySlug(slug: string): Promise<Restaurant | null> {
    const result = await query(
      `SELECT ${RESTAURANT_COLS} FROM restaurants WHERE slug = $1 LIMIT 1`,
      [slug],
    );
    return result.rows[0] || null;
  }

  async update(
    restaurantId: string,
    updates: Partial<{
      name: string;
      slug: string;
      auto_approve_online_orders: boolean;
      delay_threshold_minutes: number;
      qr_mode: string;
      features: Record<string, boolean>;
      gstin: string | null;
      tax_rate: number;
      tax_inclusive: boolean;
      restaurant_type: string;
      qsr_enabled: boolean;
      ordering_enabled: boolean;
      token_prefix: string;
      token_daily_reset: boolean;
      logo_url: string | null;
      hero_image_url: string | null;
      tagline: string | null;
      description: string | null;
      address: string | null;
      phone: string | null;
      whatsapp: string | null;
      public_email: string | null;
      social_links: Record<string, string>;
      website_published: boolean;
      default_landing_page: string;
      fssai_no: string | null;
      upi_id: string | null;
      discount_percent: number;
      service_charge_percent: number;
      other_charges_percent: number;
      extra_charges_amount: number;
      show_name_in_bill: boolean;
      bill_social_keys: string[];
    }>,
  ): Promise<Restaurant | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.name !== undefined) { fields.push(`name = $${paramIndex++}`); values.push(updates.name); }
    if (updates.slug !== undefined) { fields.push(`slug = $${paramIndex++}`); values.push(updates.slug); }
    if (updates.auto_approve_online_orders !== undefined) { fields.push(`auto_approve_online_orders = $${paramIndex++}`); values.push(updates.auto_approve_online_orders); }
    if (updates.delay_threshold_minutes !== undefined) { fields.push(`delay_threshold_minutes = $${paramIndex++}`); values.push(updates.delay_threshold_minutes); }
    if (updates.qr_mode !== undefined) { fields.push(`qr_mode = $${paramIndex++}`); values.push(updates.qr_mode); }
    if (updates.features !== undefined) { fields.push(`features = features || $${paramIndex++}::jsonb`); values.push(JSON.stringify(updates.features)); }
    if (updates.gstin !== undefined) { fields.push(`gstin = $${paramIndex++}`); values.push(updates.gstin); }
    if (updates.tax_rate !== undefined) { fields.push(`tax_rate = $${paramIndex++}`); values.push(updates.tax_rate); }
    if (updates.tax_inclusive !== undefined) { fields.push(`tax_inclusive = $${paramIndex++}`); values.push(updates.tax_inclusive); }
    if (updates.restaurant_type !== undefined) { fields.push(`restaurant_type = $${paramIndex++}`); values.push(updates.restaurant_type); }
    if (updates.ordering_enabled !== undefined) { fields.push(`ordering_enabled = $${paramIndex++}`); values.push(updates.ordering_enabled); }
    if (updates.qsr_enabled !== undefined) { fields.push(`qsr_enabled = $${paramIndex++}`); values.push(updates.qsr_enabled); }
    if (updates.token_prefix !== undefined) { fields.push(`token_prefix = $${paramIndex++}`); values.push(updates.token_prefix); }
    if (updates.token_daily_reset !== undefined) { fields.push(`token_daily_reset = $${paramIndex++}`); values.push(updates.token_daily_reset); }
    if (updates.logo_url !== undefined) { fields.push(`logo_url = $${paramIndex++}`); values.push(updates.logo_url); }
    if (updates.hero_image_url !== undefined) { fields.push(`hero_image_url = $${paramIndex++}`); values.push(updates.hero_image_url); }
    if (updates.tagline !== undefined) { fields.push(`tagline = $${paramIndex++}`); values.push(updates.tagline); }
    if (updates.description !== undefined) { fields.push(`description = $${paramIndex++}`); values.push(updates.description); }
    if (updates.address !== undefined) { fields.push(`address = $${paramIndex++}`); values.push(updates.address); }
    if (updates.phone !== undefined) { fields.push(`phone = $${paramIndex++}`); values.push(updates.phone); }
    if (updates.whatsapp !== undefined) { fields.push(`whatsapp = $${paramIndex++}`); values.push(updates.whatsapp); }
    if (updates.public_email !== undefined) { fields.push(`public_email = $${paramIndex++}`); values.push(updates.public_email); }
    if (updates.social_links !== undefined) { fields.push(`social_links = $${paramIndex++}::jsonb`); values.push(JSON.stringify(updates.social_links)); }
    if (updates.website_published !== undefined) { fields.push(`website_published = $${paramIndex++}`); values.push(updates.website_published); }
    if (updates.default_landing_page !== undefined) { fields.push(`default_landing_page = $${paramIndex++}`); values.push(updates.default_landing_page); }
    if (updates.fssai_no !== undefined) { fields.push(`fssai_no = $${paramIndex++}`); values.push(updates.fssai_no); }
    if (updates.upi_id !== undefined) { fields.push(`upi_id = $${paramIndex++}`); values.push(updates.upi_id); }
    if (updates.discount_percent !== undefined) { fields.push(`discount_percent = $${paramIndex++}`); values.push(updates.discount_percent); }
    if (updates.service_charge_percent !== undefined) { fields.push(`service_charge_percent = $${paramIndex++}`); values.push(updates.service_charge_percent); }
    if (updates.other_charges_percent !== undefined) { fields.push(`other_charges_percent = $${paramIndex++}`); values.push(updates.other_charges_percent); }
    if (updates.extra_charges_amount !== undefined) { fields.push(`extra_charges_amount = $${paramIndex++}`); values.push(updates.extra_charges_amount); }
    if (updates.show_name_in_bill !== undefined) { fields.push(`show_name_in_bill = $${paramIndex++}`); values.push(updates.show_name_in_bill); }
    if (updates.bill_social_keys !== undefined) { fields.push(`bill_social_keys = $${paramIndex++}::jsonb`); values.push(JSON.stringify(updates.bill_social_keys)); }

    if (fields.length === 0) return this.findById(restaurantId);

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(restaurantId);

    const result = await query(
      `UPDATE restaurants SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING ${RESTAURANT_COLS}`,
      values,
    );
    return result.rows[0] || null;
  }

  /**
   * Atomically increment and return the next token number for a restaurant.
   * Resets the counter to 1 if token_daily_reset is true and the last reset
   * was not today. Returns the new counter value.
   */
  async nextTokenNumber(restaurantId: string): Promise<number> {
    const result = await query(
      `UPDATE restaurants
       SET
         token_counter = CASE
           WHEN token_daily_reset AND (token_last_reset_at IS NULL OR token_last_reset_at < ${todayLocal})
           THEN 1
           ELSE token_counter + 1
         END,
         token_last_reset_at = CASE
           WHEN token_daily_reset AND (token_last_reset_at IS NULL OR token_last_reset_at < ${todayLocal})
           THEN ${todayLocal}
           ELSE token_last_reset_at
         END
       WHERE id = $1
       RETURNING token_counter`,
      [restaurantId],
    );
    return result.rows[0].token_counter as number;
  }

  async delete(restaurantId: string): Promise<boolean> {
    const result = await query('DELETE FROM restaurants WHERE id = $1', [restaurantId]);
    return (result.rowCount ?? 0) > 0;
  }

  async slugExists(slug: string, excludeId?: string): Promise<boolean> {
    let queryText = 'SELECT 1 FROM restaurants WHERE slug = $1';
    const params: any[] = [slug];
    if (excludeId) { queryText += ' AND id != $2'; params.push(excludeId); }
    queryText += ' LIMIT 1';
    const result = await query(queryText, params);
    return result.rows.length > 0;
  }

  async getStats(restaurantId: string): Promise<RestaurantStats> {
    const usersResult = await query(
      'SELECT COUNT(*) as total, COUNT(CASE WHEN is_active = true THEN 1 END) as active FROM users WHERE restaurant_id = $1',
      [restaurantId],
    );
    const tablesResult = await query(
      'SELECT COUNT(*) as total, COUNT(CASE WHEN is_active = true THEN 1 END) as active FROM restaurant_tables WHERE restaurant_id = $1',
      [restaurantId],
    );
    const ordersResult = await query(
      `SELECT
         (SELECT COUNT(*) FROM orders WHERE restaurant_id = $1 AND ${isToday('created_at')}) as total_orders,
         (SELECT COALESCE(SUM(amount), 0) FROM payments
           WHERE restaurant_id = $1 AND is_test = FALSE AND status = 'PAID' AND ${isToday('created_at')}) as revenue`,
      [restaurantId],
    );
    const users = usersResult.rows[0];
    const tables = tablesResult.rows[0];
    const orders = ordersResult.rows[0] || { total_orders: 0, revenue: 0 };
    return {
      total_users: parseInt(users.total) || 0,
      active_users: parseInt(users.active) || 0,
      total_tables: parseInt(tables.total) || 0,
      active_tables: parseInt(tables.active) || 0,
      total_orders_today: parseInt(orders.total_orders) || 0,
      revenue_today: parseFloat(orders.revenue) || 0,
    };
  }

  async findAll(limit: number = 50, offset: number = 0): Promise<Restaurant[]> {
    const result = await query(
      `SELECT ${RESTAURANT_COLS} FROM restaurants ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return result.rows;
  }

  async count(): Promise<number> {
    const result = await query('SELECT COUNT(*) as count FROM restaurants');
    return parseInt(result.rows[0].count) || 0;
  }

  // ── Sections ────────────────────────────────────────────────────────────────

  async findSectionsByRestaurantId(restaurantId: string): Promise<RestaurantSection[]> {
    const result = await query(
      `SELECT id, restaurant_id, name, display_order, is_active, created_at, updated_at
       FROM restaurant_sections
       WHERE restaurant_id = $1
       ORDER BY display_order ASC, name ASC`,
      [restaurantId],
    );
    return result.rows;
  }

  async createSection(restaurantId: string, name: string, displayOrder: number): Promise<RestaurantSection> {
    const result = await query(
      `INSERT INTO restaurant_sections (restaurant_id, name, display_order)
       VALUES ($1, $2, $3)
       RETURNING id, restaurant_id, name, display_order, is_active, created_at, updated_at`,
      [restaurantId, name, displayOrder],
    );
    return result.rows[0];
  }

  async updateSection(
    sectionId: string,
    restaurantId: string,
    updates: Partial<{ name: string; display_order: number; is_active: boolean }>,
  ): Promise<RestaurantSection | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;
    if (updates.name !== undefined) { fields.push(`name = $${i++}`); values.push(updates.name); }
    if (updates.display_order !== undefined) { fields.push(`display_order = $${i++}`); values.push(updates.display_order); }
    if (updates.is_active !== undefined) { fields.push(`is_active = $${i++}`); values.push(updates.is_active); }
    if (fields.length === 0) return null;
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(sectionId, restaurantId);
    const result = await query(
      `UPDATE restaurant_sections SET ${fields.join(', ')}
       WHERE id = $${i} AND restaurant_id = $${i + 1}
       RETURNING id, restaurant_id, name, display_order, is_active, created_at, updated_at`,
      values,
    );
    return result.rows[0] || null;
  }

  async deleteSection(sectionId: string, restaurantId: string): Promise<boolean> {
    const result = await query(
      'DELETE FROM restaurant_sections WHERE id = $1 AND restaurant_id = $2',
      [sectionId, restaurantId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async assignCategoryToSection(categoryId: string, sectionId: string | null, restaurantId: string): Promise<void> {
    await query(
      `UPDATE menu_categories SET section_id = $1
       WHERE id = $2 AND restaurant_id = $3`,
      [sectionId, categoryId, restaurantId],
    );
  }

  // ── Theme (public website colors / font) ─────────────────────────────────────

  async getTheme(restaurantId: string): Promise<RestaurantTheme | null> {
    const result = await query(
      `SELECT id, restaurant_id, primary_color, secondary_color, accent_color,
              background_color, text_color, font_family, created_at, updated_at
       FROM restaurant_themes WHERE restaurant_id = $1 LIMIT 1`,
      [restaurantId],
    );
    return result.rows[0] || null;
  }

  async upsertTheme(
    restaurantId: string,
    updates: Partial<{
      primary_color: string;
      secondary_color: string;
      accent_color: string;
      background_color: string;
      text_color: string;
      font_family: string;
    }>,
  ): Promise<RestaurantTheme> {
    const result = await query(
      `INSERT INTO restaurant_themes (restaurant_id, primary_color, secondary_color, accent_color, background_color, text_color, font_family)
       VALUES ($1, COALESCE($2, '#111827'), COALESCE($3, '#f59e0b'), COALESCE($4, '#10b981'), COALESCE($5, '#ffffff'), COALESCE($6, '#111827'), COALESCE($7, 'Inter'))
       ON CONFLICT (restaurant_id) DO UPDATE SET
         primary_color    = COALESCE($2, restaurant_themes.primary_color),
         secondary_color  = COALESCE($3, restaurant_themes.secondary_color),
         accent_color     = COALESCE($4, restaurant_themes.accent_color),
         background_color = COALESCE($5, restaurant_themes.background_color),
         text_color       = COALESCE($6, restaurant_themes.text_color),
         font_family      = COALESCE($7, restaurant_themes.font_family),
         updated_at       = CURRENT_TIMESTAMP
       RETURNING id, restaurant_id, primary_color, secondary_color, accent_color, background_color, text_color, font_family, created_at, updated_at`,
      [
        restaurantId,
        updates.primary_color ?? null,
        updates.secondary_color ?? null,
        updates.accent_color ?? null,
        updates.background_color ?? null,
        updates.text_color ?? null,
        updates.font_family ?? null,
      ],
    );
    return result.rows[0];
  }
}

export const restaurantsRepository = new RestaurantsRepository();
