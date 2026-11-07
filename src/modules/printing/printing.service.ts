import { ordersRepository } from '@/modules/orders/orders.repository';
import { restaurantsRepository } from '@/modules/restaurants/restaurants.repository';
import { printingRepository } from './printing.repository';

interface KotItem {
  name: string;
  quantity: number;
  weight_grams: number | null;
  special_instructions: string | null;
  modifiers: string[];
}

export class PrintingService {
  /**
   * Send a KOT to the kitchen printer (via the bridge) for every item of the order that has not
   * been sent yet — one ticket per round. Safe to call repeatedly: items are marked as sent
   * atomically, so nothing prints twice. Does nothing unless the restaurant turned the bridge on.
   * QR / online orders that still wait for acceptance are skipped until they are accepted.
   */
  async enqueueUnprintedKot(orderId: string, restaurantId: string): Promise<number> {
    const settings = await printingRepository.getSettings(restaurantId);
    if (!settings?.enabled || !settings.auto_kot) return 0;

    const order = await ordersRepository.findByIdWithDetails(orderId);
    if (!order || order.restaurant_id !== restaurantId) return 0;
    if (!['ACCEPTED', 'PREPARING'].includes(order.status)) return 0;

    const all = ((order as any).order_items || []) as any[];
    const unprinted = all.filter((it) => it.status !== 'CANCELLED' && !it.kot_printed_at && !it.skip_kitchen);
    if (unprinted.length === 0) return 0;

    const claimedIds = new Set(await printingRepository.claimUnprintedItems(orderId, restaurantId, unprinted.map((i) => i.id)));
    const toPrint = unprinted.filter((i) => claimedIds.has(i.id));
    if (toPrint.length === 0) return 0;

    const restaurant = await restaurantsRepository.findById(restaurantId);
    const byRound = new Map<number, any[]>();
    for (const it of toPrint) {
      const round = Number(it.round) || 1;
      byRound.set(round, [...(byRound.get(round) || []), it]);
    }

    let jobs = 0;
    try {
      for (const [round, items] of [...byRound.entries()].sort((a, b) => a[0] - b[0])) {
        const kotItems: KotItem[] = items.map((it) => ({
          name: it.menu_item_name || 'Item',
          quantity: it.quantity,
          weight_grams: it.weight_grams ?? null,
          special_instructions: it.special_instructions ?? null,
          modifiers: (it.modifiers || []).map((m: any) => m.modifier_option_name),
        }));
        await printingRepository.enqueue(restaurantId, 'KOT', 'KOT', {
          restaurant_name: restaurant?.name || 'Kitchen',
          order_number: order.order_number,
          table_number: (order as any).table?.table_number ?? null,
          order_type: order.order_type,
          order_source: order.order_source,
          guest_label: (order as any).guest_label ?? null,
          special_instructions: order.special_instructions ?? null,
          created_at: new Date().toISOString(),
          round,
          items: kotItems,
        });
        jobs++;
      }
    } catch (err) {
      // Could not queue: release the items so the kitchen screen (or a retry) can still print them
      await printingRepository.unmarkItems(orderId, restaurantId, toPrint.map((i) => i.id)).catch(() => {});
      throw err;
    }
    return jobs;
  }

  /** Queue ready-made ESC/POS bytes (e.g. a receipt built in the browser). */
  async enqueueRaw(restaurantId: string, target: 'KOT' | 'BILL', dataBase64: string): Promise<string> {
    return printingRepository.enqueue(restaurantId, target, 'RAW', { data: dataBase64 });
  }
}

export const printingService = new PrintingService();
