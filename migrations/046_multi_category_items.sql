-- 046_multi_category_items.sql
-- 1) A menu item can now belong to MORE THAN ONE category.
--      menu_item_categories   (item <-> category links)
--      menu_items.category_id stays as the item's "main" category (first one picked),
--      so older code, reports and kitchen sections keep working.
-- 2) Categories get a visibility switch.
--      menu_categories.show_to_customers
--        TRUE  (default) = shown everywhere (customer QR menu, website, POS, staff, waiter app)
--        FALSE           = shown only on the POS / staff side (never to customers)
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS menu_item_categories (
    menu_item_id  UUID NOT NULL REFERENCES menu_items(id)      ON DELETE CASCADE,
    category_id   UUID NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL REFERENCES restaurants(id)     ON DELETE CASCADE,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (menu_item_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_menu_item_categories_category   ON menu_item_categories(category_id);
CREATE INDEX IF NOT EXISTS idx_menu_item_categories_restaurant ON menu_item_categories(restaurant_id);

-- Every existing item keeps its current category.
INSERT INTO menu_item_categories (menu_item_id, category_id, restaurant_id)
SELECT id, category_id, restaurant_id FROM menu_items
ON CONFLICT DO NOTHING;

ALTER TABLE menu_categories
    ADD COLUMN IF NOT EXISTS show_to_customers BOOLEAN NOT NULL DEFAULT TRUE;

-- Same access rules as the other tenant tables.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON menu_item_categories TO app_tenant;
  END IF;
END $$;

ALTER TABLE menu_item_categories ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY tenant_isolation_menu_item_categories ON menu_item_categories
    USING (restaurant_id::text = current_setting('app.restaurant_id', true))
    WITH CHECK (restaurant_id::text = current_setting('app.restaurant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
