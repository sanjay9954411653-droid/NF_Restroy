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
  /** By-weight items only: price of ONE piece, when the item can also be sold by the piece */
  piece_price?: number | null
  prep_time_minutes: number
  is_vegetarian: boolean
  image_url?: string | null
  is_featured?: boolean
  /** Ready-made item (samosa, drinks...): skips the kitchen, goes straight to the waiter */
  skip_kitchen?: boolean
  /** FALSE = today's batch is finished, so the item goes to the kitchen again */
  ready_in_stock?: boolean
  is_active: boolean
  display_order: number
  created_at: string
  updated_at: string
}
