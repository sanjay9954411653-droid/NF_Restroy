// Period picker helpers shared by report cards. Dates are the browser's LOCAL calendar days
// (YYYY-MM-DD), so "today" means the owner's today, not UTC's.

export type RangeKey = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'all' | 'custom'

export const ymd = (d: Date): string => d.toLocaleDateString('en-CA')

export function rangeDates(key: Exclude<RangeKey, 'all' | 'custom'>): { from: string; to: string } {
  const now = new Date()
  const day = (offset: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + offset)
    return ymd(d)
  }
  switch (key) {
    case 'yesterday': return { from: day(-1), to: day(-1) }
    case '7d':        return { from: day(-6), to: day(0) }
    case '30d':       return { from: day(-29), to: day(0) }
    case 'month':     return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: day(0) }
    default:          return { from: day(0), to: day(0) }
  }
}
