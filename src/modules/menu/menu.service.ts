import { menuRepository } from './menu.repository';
import {
  MenuCategory,
  MenuItem,
  MenuStats,
  CreateMenuCategoryRequest,
  UpdateMenuCategoryRequest,
  CreateMenuItemRequest,
  UpdateMenuItemRequest,
} from './menu.types';
import { BadRequestError, ConflictError, NotFoundError } from '@/shared/errors/AppError';

export class MenuService {
  async reorder(restaurantId: string, type: 'categories' | 'items', ids: string[]): Promise<void> {
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestError('Duplicate ids in reorder list');
    }
    const table = type === 'categories' ? 'menu_categories' : 'menu_items';
    const owned = await menuRepository.countOwned(table, restaurantId, ids);
    if (owned !== ids.length) {
      throw new BadRequestError('Some of these do not belong to this restaurant');
    }
    await menuRepository.reorder(table, restaurantId, ids);
  }

  validateCategoryName(name: string): string {
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 255) {
      throw new BadRequestError('Category name must be between 2 and 255 characters');
    }
    return trimmed;
  }

  validateMenuItemName(name: string): string {
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 255) {
      throw new BadRequestError('Menu item name must be between 2 and 255 characters');
    }
    return trimmed;
  }

  async createCategory(restaurantId: string, payload: CreateMenuCategoryRequest): Promise<MenuCategory> {
    const { name, description, display_order, is_active, show_to_customers } = payload;
    const validatedName = this.validateCategoryName(name);

    if (await menuRepository.categoryNameExists(restaurantId, validatedName)) {
      throw new ConflictError('Menu category name already exists for this restaurant');
    }

    return menuRepository.createCategory(restaurantId, validatedName, description ?? null, display_order, is_active, show_to_customers ?? true);
  }

  async getCategory(categoryId: string): Promise<MenuCategory> {
    const category = await menuRepository.findCategoryById(categoryId);
    if (!category) {
      throw new NotFoundError('Menu category not found');
    }
    return category;
  }

  async getCategories(restaurantId: string): Promise<MenuCategory[]> {
    return menuRepository.findCategoriesByRestaurantId(restaurantId);
  }

  async updateCategory(categoryId: string, restaurantId: string, payload: UpdateMenuCategoryRequest): Promise<MenuCategory> {
    const existing = await this.getCategory(categoryId);
    if (existing.restaurant_id !== restaurantId) {
      throw new NotFoundError('Menu category not found');
    }

    const updates: any = {};
    if (payload.name !== undefined) {
      const validatedName = this.validateCategoryName(payload.name);
      if (validatedName !== existing.name && await menuRepository.categoryNameExists(restaurantId, validatedName, categoryId)) {
        throw new ConflictError('Menu category name already exists for this restaurant');
      }
      updates.name = validatedName;
    }
    if (payload.description !== undefined) {
      updates.description = payload.description ?? null;
    }
    if (payload.display_order !== undefined) {
      updates.display_order = payload.display_order;
    }
    if (payload.is_active !== undefined) {
      updates.is_active = payload.is_active;
    }
    if (payload.show_to_customers !== undefined) {
      updates.show_to_customers = payload.show_to_customers;
    }

    const updated = await menuRepository.updateCategory(categoryId, updates);
    if (!updated) {
      throw new NotFoundError('Menu category not found');
    }
    return updated;
  }

  async deleteCategory(categoryId: string, restaurantId: string): Promise<void> {
    const category = await this.getCategory(categoryId);
    if (category.restaurant_id !== restaurantId) {
      throw new NotFoundError('Menu category not found');
    }

    const deleted = await menuRepository.deleteCategory(categoryId);
    if (!deleted) {
      throw new NotFoundError('Menu category not found');
    }
  }

  /** category_ids (new) or category_id (old clients) -> unique list; first = main category. */
  private async resolveCategoryIds(restaurantId: string, ids: string[]): Promise<string[]> {
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) {
      throw new BadRequestError('Pick at least one category');
    }
    const owned = await menuRepository.countOwned('menu_categories', restaurantId, unique);
    if (owned !== unique.length) {
      throw new BadRequestError('Menu category does not belong to this restaurant');
    }
    return unique;
  }

  async createMenuItem(restaurantId: string, payload: CreateMenuItemRequest): Promise<MenuItem> {
    const { name, description, price, prep_time_minutes, is_vegetarian, is_active, display_order, image_url, is_featured, price_unit, skip_kitchen, ready_in_stock } = payload;
    const validatedName = this.validateMenuItemName(name);

    const categoryIds = await this.resolveCategoryIds(
      restaurantId,
      payload.category_ids ?? (payload.category_id ? [payload.category_id] : [])
    );

    if (await menuRepository.menuItemNameExists(restaurantId, validatedName)) {
      throw new ConflictError('Menu item name already exists for this restaurant');
    }

    const created = await menuRepository.createMenuItem(
      restaurantId,
      categoryIds[0],
      validatedName,
      description ?? null,
      price,
      prep_time_minutes,
      is_vegetarian,
      is_active,
      display_order,
      image_url || null,
      is_featured ?? false,
      price_unit ?? 'PIECE',
      skip_kitchen ?? false,
      ready_in_stock ?? true
    );
    await menuRepository.setItemCategories(created.id, restaurantId, categoryIds);
    return this.getMenuItem(created.id);
  }

  async getMenuItem(menuItemId: string): Promise<MenuItem> {
    const item = await menuRepository.findMenuItemById(menuItemId);
    if (!item) {
      throw new NotFoundError('Menu item not found');
    }
    return item;
  }

  async getMenuItems(restaurantId: string): Promise<MenuItem[]> {
    return menuRepository.findMenuItemsByRestaurantId(restaurantId);
  }

  async updateMenuItem(menuItemId: string, restaurantId: string, payload: UpdateMenuItemRequest): Promise<MenuItem> {
    const existing = await this.getMenuItem(menuItemId);
    if (existing.restaurant_id !== restaurantId) {
      throw new NotFoundError('Menu item not found');
    }

    const updates: any = {};
    let newCategoryIds: string[] | null = null;
    if (payload.category_ids !== undefined || payload.category_id !== undefined) {
      newCategoryIds = await this.resolveCategoryIds(
        restaurantId,
        payload.category_ids ?? (payload.category_id ? [payload.category_id] : [])
      );
    }
    if (payload.name !== undefined) {
      const validatedName = this.validateMenuItemName(payload.name);
      if (validatedName !== existing.name && await menuRepository.menuItemNameExists(restaurantId, validatedName, menuItemId)) {
        throw new ConflictError('Menu item name already exists for this restaurant');
      }
      updates.name = validatedName;
    }
    if (payload.description !== undefined) {
      updates.description = payload.description ?? null;
    }
    if (payload.price !== undefined) {
      updates.price = payload.price;
    }
    if (payload.prep_time_minutes !== undefined) {
      updates.prep_time_minutes = payload.prep_time_minutes;
    }
    if (payload.is_vegetarian !== undefined) {
      updates.is_vegetarian = payload.is_vegetarian;
    }
    if (payload.is_active !== undefined) {
      updates.is_active = payload.is_active;
    }
    if (payload.display_order !== undefined) {
      updates.display_order = payload.display_order;
    }
    if (payload.image_url !== undefined) {
      updates.image_url = payload.image_url || null; // '' clears the image
    }
    if (payload.is_featured !== undefined) {
      updates.is_featured = payload.is_featured;
    }
    if (payload.skip_kitchen !== undefined) {
      updates.skip_kitchen = payload.skip_kitchen;
    }
    if (payload.ready_in_stock !== undefined) {
      updates.ready_in_stock = payload.ready_in_stock;
    }
    if (payload.price_unit !== undefined) {
      updates.price_unit = payload.price_unit;
    }

    const updated = await menuRepository.updateMenuItem(menuItemId, updates);
    if (!updated) {
      throw new NotFoundError('Menu item not found');
    }
    if (newCategoryIds) {
      await menuRepository.setItemCategories(menuItemId, restaurantId, newCategoryIds);
      return this.getMenuItem(menuItemId);
    }
    return updated;
  }

  async deleteMenuItem(menuItemId: string, restaurantId: string): Promise<void> {
    const item = await this.getMenuItem(menuItemId);
    if (item.restaurant_id !== restaurantId) {
      throw new NotFoundError('Menu item not found');
    }

    const deleted = await menuRepository.deleteMenuItem(menuItemId);
    if (!deleted) {
      throw new NotFoundError('Menu item not found');
    }
  }

  async getMenuOverview(restaurantId: string): Promise<{ categories: MenuCategory[]; items: MenuItem[] }> {
    const [categories, items] = await Promise.all([
      this.getCategories(restaurantId),
      this.getMenuItems(restaurantId),
    ]);
    return { categories, items };
  }

  async getMenuStats(restaurantId: string): Promise<MenuStats> {
    return menuRepository.getMenuStats(restaurantId);
  }
}

export const menuService = new MenuService();