/**
 * Forgiving dish search for the waiter menu.
 *  - ignores case, accents and punctuation
 *  - every typed word must match; words can match anywhere in the name ("masala" finds "Chicken tikka masala")
 *  - short codes work: "cbm" finds "Chicken butter masala" (first letters of each word)
 *  - small spelling slips work: "chiken" finds "Chicken ..."
 *  - category names count too: "thali" or "starters"
 * Better matches come first (name starts with what you typed, then word starts, then the rest).
 */

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Edit distance, stopping early once it is clearly above `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      cur.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/** How well one typed word matches one dish. 0 = no match. */
function tokenScore(token: string, name: string, words: string[], initials: string, cats: string): number {
  if (words.some((w) => w.startsWith(token))) return 4
  if (name.includes(token)) return 3
  if (token.length >= 2 && initials.startsWith(token)) return 3
  if (token.length >= 2 && initials.includes(token)) return 2
  if (cats.includes(token)) return 2
  if (token.length >= 4) {
    const max = token.length >= 7 ? 2 : 1
    for (const w of words) {
      if (editDistance(token, w.slice(0, token.length), max) <= max || editDistance(token, w, max) <= max) return 1
    }
  }
  return 0
}

export interface SearchableItem {
  name: string
  category_id?: string
  category_ids?: string[]
}

/** Returns the matching items, best match first. An empty query returns the items unchanged. */
export function searchMenu<T extends SearchableItem>(
  items: T[],
  query: string,
  categoryNameById: Map<string, string>,
): T[] {
  const q = normalize(query)
  if (!q) return items
  const tokens = q.split(' ')

  const scored: { item: T; score: number; index: number }[] = []
  items.forEach((item, index) => {
    const name = normalize(item.name)
    const words = name.split(' ')
    const initials = words.map((w) => w[0]).join('')
    const ids = item.category_ids?.length ? item.category_ids : item.category_id ? [item.category_id] : []
    const cats = ids.map((id) => normalize(categoryNameById.get(id) || '')).join(' ')

    let total = 0
    for (const t of tokens) {
      const s = tokenScore(t, name, words, initials, cats)
      if (s === 0) return
      total += s
    }
    if (name.startsWith(q)) total += 5
    scored.push({ item, score: total, index })
  })

  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map((s) => s.item)
}
