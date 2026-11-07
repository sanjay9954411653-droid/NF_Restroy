/** Friendly order type for bills: DINE_IN -> "Dine-in", PARCEL -> "Pick-up", ONLINE -> "Online". */
export function orderTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case 'DINE_IN': return 'Dine-in'
    case 'PARCEL':  return 'Pick-up'
    case 'ONLINE':  return 'Online'
    default:        return type ? String(type).replace(/_/g, ' ') : ''
  }
}
