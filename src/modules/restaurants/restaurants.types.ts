import { z } from 'zod';

export type RestaurantType =
  | 'FULL_SERVICE'
  | 'QSR_SIMPLE'
  | 'QSR_CHAIN'
  | 'CAFE'
  | 'CLOUD_KITCHEN'
  | 'HYBRID';

export const CreateRestaurantRequestSchema = z.object({
  name: z.string().min(2).max(255),
  auto_approve_online_orders: z.boolean().default(false),
  delay_threshold_minutes: z.number().int().min(1).max(120).default(15),
});

export const UpdateRestaurantRequestSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  auto_approve_online_orders: z.boolean().optional(),
  delay_threshold_minutes: z.number().int().min(1).max(120).optional(),
  qr_mode: z.enum(['restaurant', 'mall']).optional(),
  gstin: z.string().max(15).nullable().optional(),
  tax_rate: z.number().min(0).max(100).optional(),
  tax_inclusive: z.boolean().optional(),
  restaurant_type: z.enum(['FULL_SERVICE','QSR_SIMPLE','QSR_CHAIN','CAFE','CLOUD_KITCHEN','HYBRID']).optional(),
  qsr_enabled: z.boolean().optional(),
  ordering_enabled: z.boolean().optional(),
  token_prefix: z.string().max(10).optional(),
  token_daily_reset: z.boolean().optional(),
  features: z.object({
    kitchen_display: z.boolean().optional(),
    inventory:       z.boolean().optional(),
    reports:         z.boolean().optional(),
    qr_ordering:     z.boolean().optional(),
    whatsapp:        z.boolean().optional(),
    zomato:          z.boolean().optional(),
    payments:        z.boolean().optional(),
    waiter_app:      z.boolean().optional(),
    menu_accordion:  z.boolean().optional(),
  }).optional(),
  // ── Branding / public website fields ────────────────────────────────────────
  logo_url:          z.string().max(2048).nullable().optional(),
  hero_image_url:    z.string().max(2048).nullable().optional(),
  tagline:           z.string().max(255).nullable().optional(),
  description:       z.string().max(5000).nullable().optional(),
  address:           z.string().max(1000).nullable().optional(),
  phone:             z.string().max(20).nullable().optional(),
  whatsapp:          z.string().max(20).nullable().optional(),
  public_email:      z.string().max(255).nullable().optional(),
  social_links:      z.record(z.string()).optional(),
  default_landing_page: z.enum(['dashboard','orders','tables','kitchen','menu','reports']).optional(),
  website_published: z.boolean().optional(),
  // ── Bill / receipt fields ────────────────────────────────────────────────────
  fssai_no:               z.string().max(20).nullable().optional(),
  upi_id:                 z.string().max(100).nullable().optional(),
  discount_percent:       z.number().min(0).max(100).optional(),
  service_charge_percent: z.number().min(0).max(100).optional(),
  other_charges_percent:  z.number().min(0).max(100).optional(),
  extra_charges_amount:   z.number().min(0).optional(),
  show_name_in_bill:      z.boolean().optional(),
  bill_social_keys:       z.array(z.string()).optional(),
});

export type CreateRestaurantRequest = z.infer<typeof CreateRestaurantRequestSchema>;
export type UpdateRestaurantRequest = z.infer<typeof UpdateRestaurantRequestSchema>;

// ── Theme (colors / font used by the public website) ─────────────────────────

export const UpdateThemeRequestSchema = z.object({
  primary_color:    z.string().regex(/^#[0-9A-Fa-f]{3,8}$/).optional(),
  secondary_color:  z.string().regex(/^#[0-9A-Fa-f]{3,8}$/).optional(),
  accent_color:     z.string().regex(/^#[0-9A-Fa-f]{3,8}$/).optional(),
  background_color: z.string().regex(/^#[0-9A-Fa-f]{3,8}$/).optional(),
  text_color:       z.string().regex(/^#[0-9A-Fa-f]{3,8}$/).optional(),
  font_family:      z.string().max(100).optional(),
});

export type UpdateThemeRequest = z.infer<typeof UpdateThemeRequestSchema>;

export interface RestaurantTheme {
  id: string;
  restaurant_id: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  background_color: string;
  text_color: string;
  font_family: string;
  created_at: Date;
  updated_at: Date;
}

export interface RestaurantFeatures {
  kitchen_display: boolean;
  inventory: boolean;
  reports: boolean;
  qr_ordering: boolean;
  whatsapp: boolean;
  zomato: boolean;
  payments: boolean;
  waiter_app: boolean;
}

export interface Restaurant {
  id: string;
  name: string;
  slug: string;
  auto_approve_online_orders: boolean;
  delay_threshold_minutes: number;
  qr_mode: 'restaurant' | 'mall';
  features: RestaurantFeatures;
  gstin: string | null;
  tax_rate: number;
  tax_inclusive: boolean;
  restaurant_type: RestaurantType;
  qsr_enabled: boolean;
  ordering_enabled: boolean;
  token_prefix: string;
  token_daily_reset: boolean;
  token_counter: number;
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
  created_at: Date;
  updated_at: Date;
}

export interface RestaurantSection {
  id: string;
  restaurant_id: string;
  name: string;
  display_order: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface RestaurantStats {
  total_users: number;
  active_users: number;
  total_tables: number;
  active_tables: number;
  total_orders_today: number;
  revenue_today: number;
}

export interface RestaurantWithStats extends Restaurant {
  stats?: RestaurantStats;
}
