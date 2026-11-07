/**
 * A menu item can be listed under several categories.
 * `category_ids` holds all of them (main category first); older responses only
 * have `category_id`, so fall back to that.
 */
export function itemCategoryIds(item: { category_id: string; category_ids?: string[] }): string[] {
  return item.category_ids && item.category_ids.length > 0 ? item.category_ids : [item.category_id]
}

/** True when the item is listed under the given category. */
export function inCategory(item: { category_id: string; category_ids?: string[] }, categoryId: string): boolean {
  return itemCategoryIds(item).includes(categoryId)
}
