export interface MenuCategory {
  id: string
  restaurant_id: string
  name: string
  description?: string
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface MenuItem {
  id: string
  restaurant_id: string
  category_id: string
  name: string
  description?: string
  price: number
  /** What the price means: per piece (default), per kg, or per 100 g */
  price_unit?: 'PIECE' | 'KG' | '100G'
  prep_time_minutes: number
  is_vegetarian: boolean
  image_url?: string | null
  is_featured?: boolean
  is_active: boolean
  display_order: number
  created_at: string
  updated_at: string
}
