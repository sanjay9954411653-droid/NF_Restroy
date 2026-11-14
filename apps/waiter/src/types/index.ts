export interface User {
  id: string
  email: string
  name: string
  role: 'ADMIN' | 'WAITER' | 'RECEPTION' | 'KITCHEN'
  restaurantId: string
}

export interface Table {
  id: string
  table_number: string
  seats: number
  is_active: boolean
}

/** Active order summary attached to a table (from GET /tables/with-status) */
export interface TableActiveOrder {
  id: string
  order_number: string
  status: OrderStatus
  total_amount: number
  order_type: string
  created_at: string
  item_count: number
  guest_label?: string | null
}

/** An open pick-up (parcel) order — no table (from GET /orders/pickups/active) */
export interface PickupOrder {
  id: string
  order_number: string
  token_number?: number | null
  status: OrderStatus
  total_amount: number
  guest_label?: string | null
  item_count: number
  created_at: string
}

/** A table enriched with its current occupancy / active order */
export interface TableWithStatus extends Table {
  active_order: TableActiveOrder | null
  /** All open orders on this table (guests A, B, C ...) */
  active_orders?: TableActiveOrder[]
}

export interface MenuCategory {
  id: string
  name: string
  display_order: number
  is_active: boolean
  show_to_customers?: boolean
}

export interface MenuItem {
  id: string
  category_id: string
  category_ids?: string[]   // every category the item is listed under
  name: string
  description?: string
  price: number
  prep_time_minutes: number
  is_vegetarian: boolean
  is_active: boolean
  skip_kitchen?: boolean     // ready-made: skips the kitchen
  ready_in_stock?: boolean   // false = batch finished, goes to the kitchen
  price_unit?: 'PIECE' | 'KG' | '100G'  // KG / 100G: `price` is per kg / per 100 g
  piece_price?: number | null           // by-weight items only: price of ONE piece (null = weight only)
}

export type OrderStatus = 'CREATED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED'
export type OrderType   = 'DINE_IN' | 'PARCEL' | 'ONLINE'
export type OrderSource = 'WAITER' | 'RECEPTION' | 'QR' | 'WHATSAPP' | 'ZOMATO'

export interface OrderItem {
  id?: string
  menu_item_id: string
  menu_item_name?: string
  quantity: number
  unit_price?: number
  special_instructions?: string
  status?: 'PENDING' | 'PREPARING' | 'DONE' | 'CANCELLED'
  kot_printed_at?: string | null
  round?: number
  served_at?: string | null
  skip_kitchen?: boolean
  weight_grams?: number | null   // by-weight lines: the weighed portion
}

export interface Order {
  id: string
  order_number: string
  order_type: OrderType
  order_source: OrderSource
  status: OrderStatus
  total_amount: number
  table_id: string | null
  table?: { id: string; table_number: string } | null
  special_instructions?: string
  created_at: string
  updated_at: string
  order_items?: OrderItem[]
  items?: OrderItem[]
}

// Cart line — what the waiter is building before submitting
export interface CartLine {
  line_id: string               // unique per cart line (an item can have several weighed lines)
  menu_item_id: string
  name: string
  price: number                 // by-weight line: the amount for that weight; otherwise per piece
  quantity: number              // by-weight lines are always 1
  special_instructions?: string
  weight_grams?: number         // by-weight line only
  price_unit?: 'KG' | '100G'    // by-weight line only (for display)
  unit_rate?: number            // menu price per kg / per 100 g (for display)
}

/** What the screens pass to addItem — the store adds the line_id. */
export type NewCartLine = Omit<CartLine, 'line_id'>

// Offline queue entry — order that couldn't be sent due to no connectivity
export interface QueuedOrder {
  id: string           // local UUID
  idempotency_key: string
  payload: {
    table_id?: string | null
    order_type: OrderType
    order_source: OrderSource
    special_instructions?: string
    items: Array<{ menu_item_id: string; quantity: number; special_instructions?: string; weight_grams?: number }>
  }
  created_at: string
  retries: number
}
