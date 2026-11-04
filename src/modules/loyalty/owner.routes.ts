/**
 * Owner-side reviews moderation + loyalty configuration.
 *
 *   GET   /api/v1/reviews                 — all reviews (incl. hidden)
 *   PATCH /api/v1/reviews/:id             { is_published }  — show/hide
 *   DELETE/api/v1/reviews/:id             — remove
 *   GET   /api/v1/loyalty/config          — current loyalty settings
 *   PATCH /api/v1/loyalty/config          { loyalty_enabled, points_per_currency, redeem_value }
 *
 * All restaurant-scoped via the staff JWT + withTenant (RLS-enforced).
 */

import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { withTenant, query } from '@/config/database';
import { successResponse } from '@/shared/utils/responseHandler';
import { NotFoundError } from '@/shared/errors/AppError';
import { authenticate, AuthenticatedRequest } from '@/shared/middleware/authenticate';
import { authorize } from '@/shared/middleware/authorize';

// ── Reviews moderation router (mounted at /reviews) ────────────────────────────
export const ownerReviewsRouter = Router();

ownerReviewsRouter.get('/', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    // 1) Reviews + order number come from restaurant-scoped tables, so row-level
    //    security limits them to this restaurant.
    const rows = await withTenant(req.user!.restaurantId, async (q) => {
      const r = await q(
        `SELECT rv.id, rv.rating, rv.title, rv.body, rv.is_published, rv.created_at,
                rv.customer_id, o.order_number
         FROM reviews rv
         LEFT JOIN orders o ON o.id = rv.order_id
         ORDER BY rv.created_at DESC LIMIT 200`,
      );
      return r.rows;
    });

    // 2) Reviewer names. `customers` is a GLOBAL table (one person can order from
    //    many restaurants) that the restricted tenant role is deliberately not
    //    allowed to read, otherwise a restaurant could see every customer's phone
    //    and email. So look up only the names of people who reviewed THIS
    //    restaurant, using the privileged connection.
    const customerIds = [...new Set(rows.map((r: { customer_id: string | null }) => r.customer_id).filter(Boolean))];
    const names = new Map<string, string | null>();
    if (customerIds.length > 0) {
      const found = await query(`SELECT id, name FROM customers WHERE id = ANY($1::uuid[])`, [customerIds]);
      for (const c of found.rows) names.set(c.id, c.name);
    }

    res.json(
      successResponse(
        rows.map(({ customer_id, ...review }: { customer_id: string | null; [k: string]: unknown }) => ({
          ...review,
          customer_name: customer_id ? names.get(customer_id) ?? null : null,
        })),
      ),
    );
  } catch (err) { next(err); }
});

// Owners can show/hide a review and clean up its wording (title / comment).
// The star rating itself can never be changed.
const ModerateSchema = z
  .object({
    is_published: z.boolean().optional(),
    title: z.string().trim().max(120).nullable().optional(),
    body: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => v.is_published !== undefined || v.title !== undefined || v.body !== undefined, {
    message: 'Nothing to update',
  });

ownerReviewsRouter.patch('/:id', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const payload = ModerateSchema.parse(req.body);

    const sets: string[] = [];
    const params: unknown[] = [];
    if (payload.is_published !== undefined) {
      params.push(payload.is_published);
      sets.push(`is_published = $${params.length}`);
    }
    if (payload.title !== undefined) {
      params.push(payload.title || null);
      sets.push(`title = $${params.length}`);
    }
    if (payload.body !== undefined) {
      params.push(payload.body || null);
      sets.push(`body = $${params.length}`);
    }
    params.push(req.params.id);

    const row = await withTenant(req.user!.restaurantId, async (q) => {
      const r = await q(
        `UPDATE reviews SET ${sets.join(', ')}, updated_at = NOW()
         WHERE id = $${params.length} RETURNING id, is_published, title, body`,
        params as any[],
      );
      return r.rows[0];
    });
    if (!row) throw new NotFoundError('Review not found');

    const onlyVisibility = payload.title === undefined && payload.body === undefined;
    const message = !onlyVisibility ? 'Review updated' : row.is_published ? 'Review published' : 'Review hidden';
    res.json(successResponse(row, { message }));
  } catch (err) { next(err); }
});

ownerReviewsRouter.delete('/:id', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const row = await withTenant(req.user!.restaurantId, async (q) => {
      const r = await q(`DELETE FROM reviews WHERE id = $1 RETURNING id`, [req.params.id]);
      return r.rows[0];
    });
    if (!row) throw new NotFoundError('Review not found');
    res.json(successResponse({ id: row.id }, { message: 'Review deleted' }));
  } catch (err) { next(err); }
});

// ── Loyalty config router (mounted at /loyalty) ────────────────────────────────
export const loyaltyConfigRouter = Router();

loyaltyConfigRouter.get('/config', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const row = await withTenant(req.user!.restaurantId, async (q) => {
      const r = await q(
        `SELECT loyalty_enabled, loyalty_points_per_currency, loyalty_redeem_value
         FROM restaurants WHERE id = $1`,
        [req.user!.restaurantId],
      );
      return r.rows[0];
    });
    res.json(successResponse(row));
  } catch (err) { next(err); }
});

const LoyaltyConfigSchema = z.object({
  loyalty_enabled: z.boolean().optional(),
  loyalty_points_per_currency: z.number().min(0).max(100).optional(),
  loyalty_redeem_value: z.number().min(0).max(1000).optional(),
});

loyaltyConfigRouter.patch('/config', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const b = LoyaltyConfigSchema.parse(req.body);
    const row = await withTenant(req.user!.restaurantId, async (q) => {
      const r = await q(
        `UPDATE restaurants SET
           loyalty_enabled = COALESCE($2, loyalty_enabled),
           loyalty_points_per_currency = COALESCE($3, loyalty_points_per_currency),
           loyalty_redeem_value = COALESCE($4, loyalty_redeem_value),
           updated_at = NOW()
         WHERE id = $1
         RETURNING loyalty_enabled, loyalty_points_per_currency, loyalty_redeem_value`,
        [req.user!.restaurantId, b.loyalty_enabled ?? null,
         b.loyalty_points_per_currency ?? null, b.loyalty_redeem_value ?? null],
      );
      return r.rows[0];
    });
    res.json(successResponse(row, { message: 'Loyalty settings updated' }));
  } catch (err) { next(err); }
});
