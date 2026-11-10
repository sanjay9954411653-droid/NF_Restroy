import { z } from 'zod';

export const CreateMenuCategoryRequestSchema = z.object({
  name: z.string().min(2, 'Category name must be at least 2 characters').max(255, 'Category name must be less than 255 characters'),
  description: z.string().max(1000).optional(),
  display_order: z.number().int().min(0).default(0),
  is_active: z.boolean().default(true),
  // true = shown everywhere (incl. customers); false = POS / staff side only
  show_to_customers: z.boolean().default(true),
});

export const UpdateMenuCategoryRequestSchema = z.object({
  name: z.string().min(2, 'Category name must be at least 2 characters').max(255, 'Category name must be less than 255 characters').optional(),
  description: z.string().max(1000).optional(),
  display_order: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
  show_to_customers: z.boolean().optional(),
});

// Image URL: https only (blocks javascript:/data: URLs). Empty string clears it.
const imageUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => v === '' || /^https:\/\//i.test(v), 'Image URL must start with https://')
  .nullable()
  .optional();

const categoryIdsSchema = z.array(z.string().uuid('Category ID must be a valid UUID')).min(1, 'Pick at least one category').max(20);

export const CreateMenuItemRequestSchema = z.object({
  // Send category_ids (one or more). category_id is still accepted for older clients.
  category_ids: categoryIdsSchema.optional(),
  category_id: z.string().uuid('Category ID must be a valid UUID').optional(),
  name: z.string().min(2, 'Menu item name must be at least 2 characters').max(255, 'Menu item name must be less than 255 characters'),
  description: z.string().max(1000).optional(),
  price: z.number().positive('Price must be greater than 0'),
  prep_time_minutes: z.number().int().min(1, 'Prep time must be at least 1 minute'),
  is_vegetarian: z.boolean().default(false),
  is_active: z.boolean().default(true),
  display_order: z.number().int().min(0).default(0),
  price_unit: z.enum(['PIECE', 'KG', '100G']).default('PIECE'), // KG / 100G: price is per kg / per 100 g
  piece_price: z.number().positive('Piece price must be greater than 0').nullable().optional(), // by-weight items only: price of ONE piece
  image_url: imageUrlSchema,
  is_featured: z.boolean().default(false),
  skip_kitchen: z.boolean().default(false), // ready-made item: goes straight to the waiter, not the kitchen
  ready_in_stock: z.boolean().default(true), // FALSE = batch finished, item goes to the kitchen again
}).refine((v) => (v.category_ids && v.category_ids.length > 0) || !!v.category_id, {
  message: 'Pick at least one category',
  path: ['category_ids'],
});

export const UpdateMenuItemRequestSchema = z.object({
  category_ids: categoryIdsSchema.optional(),
  category_id: z.string().uuid('Category ID must be a valid UUID').optional(),
  name: z.string().min(2, 'Menu item name must be at least 2 characters').max(255, 'Menu item name must be less than 255 characters').optional(),
  description: z.string().max(1000).optional(),
  price: z.number().positive('Price must be greater than 0').optional(),
  prep_time_minutes: z.number().int().min(1, 'Prep time must be at least 1 minute').optional(),
  is_vegetarian: z.boolean().optional(),
  is_active: z.boolean().optional(),
  display_order: z.number().int().min(0).optional(),
  price_unit: z.enum(['PIECE', 'KG', '100G']).optional(),
  piece_price: z.number().positive('Piece price must be greater than 0').nullable().optional(),
  image_url: imageUrlSchema,
  is_featured: z.boolean().optional(),
  skip_kitchen: z.boolean().optional(),
  ready_in_stock: z.boolean().optional(),
});

export const SetReadyStockSchema = z.object({
  ready_in_stock: z.boolean(),
});

export const ReorderMenuRequestSchema = z.object({
  type: z.enum(['categories', 'items']),
  // Full list of ids in the new order (first id = shown first).
  ids: z.array(z.string().min(1)).min(1).max(1000),
});

export type ReorderMenuRequest = z.infer<typeof ReorderMenuRequestSchema>;
export type CreateMenuCategoryRequest = z.infer<typeof CreateMenuCategoryRequestSchema>;
export type UpdateMenuCategoryRequest = z.infer<typeof UpdateMenuCategoryRequestSchema>;
export type CreateMenuItemRequest = z.infer<typeof CreateMenuItemRequestSchema>;
export type UpdateMenuItemRequest = z.infer<typeof UpdateMenuItemRequestSchema>;

export interface MenuCategory {
  id: string;
  restaurant_id: string;
  name: string;
  description?: string;
  display_order: number;
  is_active: boolean;
  show_to_customers: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface MenuItem {
  id: string;
  restaurant_id: string;
  category_id: string; // main category (first of category_ids)
  category_ids: string[]; // every category the item is listed under
  name: string;
  description?: string;
  price: number;
  prep_time_minutes: number;
  is_vegetarian: boolean;
  price_unit: 'PIECE' | 'KG' | '100G'; // KG / 100G: `price` is per kg / per 100 g
  piece_price?: number | null; // by-weight items only: price of ONE piece (null = weight only)
  image_url?: string | null;
  is_featured: boolean;
  skip_kitchen: boolean;
  ready_in_stock: boolean;
  is_active: boolean;
  display_order: number;
  created_at: Date;
  updated_at: Date;
}

export interface MenuStats {
  total_categories: number;
  active_categories: number;
  total_items: number;
  active_items: number;
}
