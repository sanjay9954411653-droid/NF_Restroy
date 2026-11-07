import crypto from 'crypto';
import { query } from '@/config/database';

export interface PrintSettings {
  restaurant_id: string;
  enabled: boolean;
  auto_kot: boolean;
  bridge_key: string;
  last_seen_at: Date | null;
}

export type PrintTarget = 'KOT' | 'BILL';
export type PrintKind = 'KOT' | 'RAW';

export interface PrintJob {
  id: string;
  target: PrintTarget;
  kind: PrintKind;
  payload: any;
  status?: string;
  attempts?: number;
  error?: string | null;
  created_at: Date;
}

const MAX_ATTEMPTS = 3;
const STALE_CLAIM_SECONDS = 60;

const newKey = () => crypto.randomBytes(24).toString('hex');
const SETTINGS_COLS = 'restaurant_id, enabled, auto_kot, bridge_key, last_seen_at';

export class PrintingRepository {
  async getSettings(restaurantId: string): Promise<PrintSettings | null> {
    const r = await query(`SELECT ${SETTINGS_COLS} FROM print_bridge_settings WHERE restaurant_id = $1`, [restaurantId]);
    return r.rows[0] ?? null;
  }

  /** Create (with a fresh key) or update the restaurant's bridge settings. */
  async upsertSettings(restaurantId: string, patch: { enabled?: boolean; auto_kot?: boolean }): Promise<PrintSettings> {
    const r = await query(
      `INSERT INTO print_bridge_settings (restaurant_id, enabled, auto_kot, bridge_key)
       VALUES ($1, COALESCE($2, FALSE), COALESCE($3, TRUE), $4)
       ON CONFLICT (restaurant_id) DO UPDATE
         SET enabled = COALESCE($2, print_bridge_settings.enabled),
             auto_kot = COALESCE($3, print_bridge_settings.auto_kot),
             updated_at = CURRENT_TIMESTAMP
       RETURNING ${SETTINGS_COLS}`,
      [restaurantId, patch.enabled ?? null, patch.auto_kot ?? null, newKey()],
    );
    return r.rows[0];
  }

  async rotateKey(restaurantId: string): Promise<PrintSettings> {
    await this.upsertSettings(restaurantId, {});
    const r = await query(
      `UPDATE print_bridge_settings SET bridge_key = $2, updated_at = CURRENT_TIMESTAMP
       WHERE restaurant_id = $1 RETURNING ${SETTINGS_COLS}`,
      [restaurantId, newKey()],
    );
    return r.rows[0];
  }

  async findByKey(key: string): Promise<PrintSettings | null> {
    const r = await query(`SELECT ${SETTINGS_COLS} FROM print_bridge_settings WHERE bridge_key = $1`, [key]);
    return r.rows[0] ?? null;
  }

  async touchSeen(restaurantId: string): Promise<void> {
    await query('UPDATE print_bridge_settings SET last_seen_at = CURRENT_TIMESTAMP WHERE restaurant_id = $1', [restaurantId]);
  }

  async enqueue(restaurantId: string, target: PrintTarget, kind: PrintKind, payload: unknown): Promise<string> {
    const r = await query(
      `INSERT INTO print_jobs (restaurant_id, target, kind, payload) VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
      [restaurantId, target, kind, JSON.stringify(payload)],
    );
    return r.rows[0].id;
  }

  /**
   * Atomically mark items as "KOT sent" and return only the ids that were not
   * already marked — so two requests can never both print the same item.
   */
  async claimUnprintedItems(orderId: string, restaurantId: string, itemIds: string[]): Promise<string[]> {
    if (itemIds.length === 0) return [];
    const r = await query(
      `UPDATE order_items SET kot_printed_at = CURRENT_TIMESTAMP
       WHERE order_id = $1 AND restaurant_id = $2 AND id = ANY($3::uuid[]) AND kot_printed_at IS NULL
       RETURNING id`,
      [orderId, restaurantId, itemIds],
    );
    return r.rows.map((x: { id: string }) => x.id);
  }

  /** Orders (accepted / preparing, last 12h) that still have items nobody has printed a KOT for. */
  async listOrdersWithUnprintedItems(restaurantId: string): Promise<string[]> {
    const r = await query(
      `SELECT o.id FROM orders o
       WHERE o.restaurant_id = $1
         AND o.status IN ('ACCEPTED', 'PREPARING')
         AND o.created_at > CURRENT_TIMESTAMP - INTERVAL '12 hours'
         AND EXISTS (
           SELECT 1 FROM order_items oi
           WHERE oi.order_id = o.id AND oi.kot_printed_at IS NULL
             AND oi.status <> 'CANCELLED' AND COALESCE(oi.skip_kitchen, FALSE) = FALSE
         )
       ORDER BY o.created_at ASC LIMIT 20`,
      [restaurantId],
    );
    return r.rows.map((x: { id: string }) => x.id);
  }

  async unmarkItems(orderId: string, restaurantId: string, itemIds: string[]): Promise<void> {
    if (itemIds.length === 0) return;
    await query(
      `UPDATE order_items SET kot_printed_at = NULL WHERE order_id = $1 AND restaurant_id = $2 AND id = ANY($3::uuid[])`,
      [orderId, restaurantId, itemIds],
    );
  }

  /** Hand pending jobs to the bridge. Jobs a bridge claimed but never finished are retried. */
  async claim(restaurantId: string, limit: number): Promise<PrintJob[]> {
    await query(
      `UPDATE print_jobs
       SET status = CASE WHEN attempts >= $2 THEN 'FAILED' ELSE 'PENDING' END,
           error = COALESCE(error, 'Bridge did not report a result')
       WHERE restaurant_id = $1 AND status = 'CLAIMED'
         AND claimed_at < CURRENT_TIMESTAMP - ($3 || ' seconds')::interval`,
      [restaurantId, MAX_ATTEMPTS, String(STALE_CLAIM_SECONDS)],
    );
    const r = await query(
      `UPDATE print_jobs
       SET status = 'CLAIMED', claimed_at = CURRENT_TIMESTAMP, attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM print_jobs
         WHERE restaurant_id = $1 AND status = 'PENDING'
         ORDER BY created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, target, kind, payload, created_at`,
      [restaurantId, limit],
    );
    // Keep the table small: forget jobs printed more than 3 days ago
    query(`DELETE FROM print_jobs WHERE restaurant_id = $1 AND status = 'PRINTED' AND printed_at < CURRENT_TIMESTAMP - INTERVAL '3 days'`, [restaurantId]).catch(() => {});
    return r.rows.sort((a: PrintJob, b: PrintJob) => +new Date(a.created_at) - +new Date(b.created_at));
  }

  async complete(restaurantId: string, jobId: string, ok: boolean, error?: string): Promise<boolean> {
    const r = ok
      ? await query(
          `UPDATE print_jobs SET status = 'PRINTED', printed_at = CURRENT_TIMESTAMP, error = NULL
           WHERE id = $1 AND restaurant_id = $2 RETURNING id`,
          [jobId, restaurantId],
        )
      : await query(
          `UPDATE print_jobs
           SET status = CASE WHEN attempts >= $3 THEN 'FAILED' ELSE 'PENDING' END, error = $4
           WHERE id = $1 AND restaurant_id = $2 RETURNING id`,
          [jobId, restaurantId, MAX_ATTEMPTS, (error || 'Print failed').slice(0, 500)],
        );
    return r.rows.length > 0;
  }

  async recent(restaurantId: string, limit = 20): Promise<Array<Omit<PrintJob, 'payload'>>> {
    const r = await query(
      `SELECT id, target, kind, status, attempts, error, created_at FROM print_jobs
       WHERE restaurant_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [restaurantId, limit],
    );
    return r.rows;
  }
}

export const printingRepository = new PrintingRepository();
