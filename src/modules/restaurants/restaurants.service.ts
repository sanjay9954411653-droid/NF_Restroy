import { restaurantsRepository } from './restaurants.repository';
import {
  Restaurant,
  RestaurantStats,
  RestaurantTheme,
  CreateRestaurantRequest,
  UpdateRestaurantRequest,
  UpdateThemeRequest,
} from './restaurants.types';
import { ConflictError, NotFoundError, BadRequestError } from '@/shared/errors/AppError';

export class RestaurantsService {
  /**
   * Generate a URL-safe slug from restaurant name
   */
  generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
  }

  /**
   * Validate and ensure unique slug
   */
  async validateSlug(slug: string, excludeId?: string): Promise<string> {
    if (!slug || slug.length < 2) {
      throw new BadRequestError('Slug must be at least 2 characters long');
    }

    if (!/^[a-z0-9-]+$/.test(slug)) {
      throw new BadRequestError('Slug can only contain lowercase letters, numbers, and hyphens');
    }

    if (slug.startsWith('-') || slug.endsWith('-')) {
      throw new BadRequestError('Slug cannot start or end with a hyphen');
    }

    const exists = await restaurantsRepository.slugExists(slug, excludeId);
    if (exists) {
      throw new ConflictError('Restaurant slug already exists');
    }

    return slug;
  }

  /**
   * Create a new restaurant
   */
  async createRestaurant(payload: CreateRestaurantRequest): Promise<Restaurant> {
    const { name, auto_approve_online_orders, delay_threshold_minutes } = payload;

    // Generate and validate slug
    let slug = this.generateSlug(name);
    let counter = 1;
    let originalSlug = slug;

    while (await restaurantsRepository.slugExists(slug)) {
      slug = `${originalSlug}-${counter}`;
      counter++;
      if (counter > 100) {
        throw new ConflictError('Unable to generate unique slug for restaurant name');
      }
    }

    // Validate the final slug
    await this.validateSlug(slug);

    return restaurantsRepository.create(
      name,
      slug,
      auto_approve_online_orders,
      delay_threshold_minutes
    );
  }

  /**
   * Get restaurant by ID
   */
  async getRestaurant(restaurantId: string): Promise<Restaurant> {
    const restaurant = await restaurantsRepository.findById(restaurantId);
    if (!restaurant) {
      throw new NotFoundError('Restaurant not found');
    }
    return restaurant;
  }

  /**
   * Get restaurant by slug
   */
  async getRestaurantBySlug(slug: string): Promise<Restaurant> {
    const restaurant = await restaurantsRepository.findBySlug(slug);
    if (!restaurant) {
      throw new NotFoundError('Restaurant not found');
    }
    return restaurant;
  }

  /**
   * Update restaurant
   */
  async updateRestaurant(restaurantId: string, payload: UpdateRestaurantRequest): Promise<Restaurant> {
    const { name, auto_approve_online_orders, delay_threshold_minutes } = payload;

    // Verify restaurant exists
    await this.getRestaurant(restaurantId);

    const updates: any = {};

    if (name !== undefined) {
      // The slug is deliberately NOT regenerated on rename: it is embedded in printed
      // table QR codes and public links (/customer?slug=...), so changing it would break them.
      updates.name = name.trim();
    }

    if (auto_approve_online_orders !== undefined) {
      updates.auto_approve_online_orders = auto_approve_online_orders;
    }

    if (delay_threshold_minutes !== undefined) {
      updates.delay_threshold_minutes = delay_threshold_minutes;
    }

    if (payload.restaurant_type !== undefined) { updates.restaurant_type = payload.restaurant_type; }
    if ((payload as any).qr_mode !== undefined) { (updates as any).qr_mode = (payload as any).qr_mode; }
    if (payload.features !== undefined) { updates.features = payload.features; }
    if ((payload as any).gstin !== undefined) { (updates as any).gstin = (payload as any).gstin; }
    if ((payload as any).tax_rate !== undefined) { (updates as any).tax_rate = (payload as any).tax_rate; }
    if ((payload as any).tax_inclusive !== undefined) { (updates as any).tax_inclusive = (payload as any).tax_inclusive; }
    if (payload.qsr_enabled !== undefined) { updates.qsr_enabled = payload.qsr_enabled; }
    if ((payload as any).ordering_enabled !== undefined) { (updates as any).ordering_enabled = (payload as any).ordering_enabled; }
    if (payload.waiter_can_collect_payment !== undefined) { updates.waiter_can_collect_payment = payload.waiter_can_collect_payment; }
    if (payload.token_prefix !== undefined) { updates.token_prefix = payload.token_prefix; }
    if (payload.token_daily_reset !== undefined) { updates.token_daily_reset = payload.token_daily_reset; }
    if (payload.logo_url !== undefined) { updates.logo_url = payload.logo_url; }
    if (payload.hero_image_url !== undefined) { updates.hero_image_url = payload.hero_image_url; }
    if (payload.tagline !== undefined) { updates.tagline = payload.tagline; }
    if (payload.description !== undefined) { updates.description = payload.description; }
    if (payload.address !== undefined) { updates.address = payload.address; }
    if (payload.phone !== undefined) { updates.phone = payload.phone; }
    if (payload.whatsapp !== undefined) { updates.whatsapp = payload.whatsapp; }
    if (payload.public_email !== undefined) { updates.public_email = payload.public_email; }
    if (payload.social_links !== undefined) { updates.social_links = payload.social_links; }
    if (payload.website_published !== undefined) { updates.website_published = payload.website_published; }
    if (payload.default_landing_page !== undefined) { updates.default_landing_page = payload.default_landing_page; }
    if (payload.fssai_no !== undefined) { updates.fssai_no = payload.fssai_no; }
    if (payload.upi_id !== undefined) { updates.upi_id = payload.upi_id; }
    if (payload.discount_percent !== undefined) { updates.discount_percent = payload.discount_percent; }
    if (payload.service_charge_percent !== undefined) { updates.service_charge_percent = payload.service_charge_percent; }
    if (payload.other_charges_percent !== undefined) { updates.other_charges_percent = payload.other_charges_percent; }
    if (payload.extra_charges_amount !== undefined) { updates.extra_charges_amount = payload.extra_charges_amount; }
    if (payload.show_name_in_bill !== undefined) { updates.show_name_in_bill = payload.show_name_in_bill; }
    if (payload.bill_social_keys !== undefined) { updates.bill_social_keys = payload.bill_social_keys; }

    const updated = await restaurantsRepository.update(restaurantId, updates);
    if (!updated) {
      throw new NotFoundError('Restaurant not found');
    }

    return updated;
  }

  /**
   * Delete restaurant
   */
  async deleteRestaurant(restaurantId: string): Promise<void> {
    // Verify restaurant exists
    await this.getRestaurant(restaurantId);

    const deleted = await restaurantsRepository.delete(restaurantId);
    if (!deleted) {
      throw new NotFoundError('Restaurant not found');
    }
  }

  /**
   * Get restaurant statistics
   */
  async getRestaurantStats(restaurantId: string): Promise<RestaurantStats> {
    // Verify restaurant exists
    await this.getRestaurant(restaurantId);

    return restaurantsRepository.getStats(restaurantId);
  }

  /**
   * Get all restaurants (admin operation)
   */
  async getAllRestaurants(limit: number = 50, offset: number = 0): Promise<Restaurant[]> {
    return restaurantsRepository.findAll(limit, offset);
  }

  async getRestaurantCount(): Promise<number> {
    return restaurantsRepository.count();
  }

  // ── Sections ────────────────────────────────────────────────────────────────

  async getSections(restaurantId: string) {
    return restaurantsRepository.findSectionsByRestaurantId(restaurantId);
  }

  async createSection(restaurantId: string, name: string, displayOrder: number = 0) {
    return restaurantsRepository.createSection(restaurantId, name.trim(), displayOrder);
  }

  async updateSection(sectionId: string, restaurantId: string, updates: Partial<{ name: string; display_order: number; is_active: boolean }>) {
    const updated = await restaurantsRepository.updateSection(sectionId, restaurantId, updates);
    if (!updated) throw new NotFoundError('Section not found');
    return updated;
  }

  async deleteSection(sectionId: string, restaurantId: string): Promise<void> {
    const deleted = await restaurantsRepository.deleteSection(sectionId, restaurantId);
    if (!deleted) throw new NotFoundError('Section not found');
  }

  async assignCategoryToSection(categoryId: string, sectionId: string | null, restaurantId: string): Promise<void> {
    await restaurantsRepository.assignCategoryToSection(categoryId, sectionId, restaurantId);
  }

  // ── Theme (public website colors / font) ─────────────────────────────────────

  async getTheme(restaurantId: string): Promise<RestaurantTheme> {
    // Verify restaurant exists
    await this.getRestaurant(restaurantId);

    const theme = await restaurantsRepository.getTheme(restaurantId);
    if (theme) return theme;

    // No row yet — return the same defaults the DB would use once saved
    return {
      id: '',
      restaurant_id: restaurantId,
      primary_color: '#111827',
      secondary_color: '#f59e0b',
      accent_color: '#10b981',
      background_color: '#ffffff',
      text_color: '#111827',
      font_family: 'Inter',
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  async updateTheme(restaurantId: string, payload: UpdateThemeRequest): Promise<RestaurantTheme> {
    // Verify restaurant exists
    await this.getRestaurant(restaurantId);

    return restaurantsRepository.upsertTheme(restaurantId, payload);
  }
}

export const restaurantsService = new RestaurantsService();
