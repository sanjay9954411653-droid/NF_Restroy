import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '@/config/database';
import { tablesController } from './tables.controller';
import { authenticate, AuthenticatedRequest } from '@/shared/middleware/authenticate';
import { authorize } from '@/shared/middleware/authorize';
import { checkSubscription } from '@/shared/middleware/checkSubscription';
import { successResponse } from '@/shared/utils/responseHandler';
import { getWaiterAccess } from '@/shared/tableAccess';

const router = Router();

/**
 * Protected routes (authentication required)
 */

// Get all tables for current restaurant
router.get('/', authenticate, (req, res, next) => tablesController.getAll(req, res, next));

// Get all tables WITH active-order status (occupancy command-center view)
// NOTE: must be declared before '/:id' so 'with-status' isn't treated as an id
router.get('/with-status', authenticate, (req, res, next) => tablesController.getAllWithStatus(req, res, next));

// Get table statistics (Admin only)
router.get('/stats', authenticate, authorize('ADMIN'), (req, res, next) => tablesController.getStats(req, res, next));

// ── "Require PIN to order" on/off switch (Admin only) ───────────────────────
// NOTE: declared before '/:id' so 'passcode-setting' isn't treated as an id.
router.get('/passcode-setting', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = req.user?.restaurantId;
    if (!restaurantId) throw new Error('User not associated with a restaurant');

    const result = await query('SELECT table_passcode_required FROM restaurants WHERE id = $1', [restaurantId]);
    res.status(200).json(successResponse({ required: result.rows[0]?.table_passcode_required !== false }));
  } catch (error) {
    next(error);
  }
});

const PasscodeSettingSchema = z.object({ required: z.boolean() });

router.put('/passcode-setting', authenticate, authorize('ADMIN'), checkSubscription, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = req.user?.restaurantId;
    if (!restaurantId) throw new Error('User not associated with a restaurant');

    const { required } = PasscodeSettingSchema.parse(req.body);
    await query(
      'UPDATE restaurants SET table_passcode_required = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [required, restaurantId],
    );
    res.status(200).json(successResponse({ required }, { message: required ? 'PIN is now required' : 'PIN is now turned off' }));
  } catch (error) {
    next(error);
  }
});

// Get specific table by ID
// What the logged-in waiter may access (used by the waiter app to hide Pick-up when not assigned)
router.get('/my-access', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const access = await getWaiterAccess(req.user);
    res.status(200).json(successResponse({ restricted: access !== null, pickup: access ? access.pickup : true }));
  } catch (error) { next(error); }
});

router.get('/:id', authenticate, (req, res, next) => tablesController.getById(req, res, next));

// Create new table (Admin only)
router.post('/', authenticate, authorize('ADMIN'), checkSubscription, (req, res, next) => tablesController.create(req, res, next));

// Update table (Admin only) - accept both PUT and PATCH
router.put('/:id', authenticate, authorize('ADMIN'), checkSubscription, (req, res, next) => tablesController.update(req, res, next));
router.patch('/:id', authenticate, authorize('ADMIN'), checkSubscription, (req, res, next) => tablesController.update(req, res, next));

// Delete table (Admin only - dangerous operation)
router.delete('/:id', authenticate, authorize('ADMIN'), checkSubscription, (req, res, next) => tablesController.delete(req, res, next));

// Regenerate a table's QR code + passcode (Admin only)
router.post('/:id/regenerate-qr', authenticate, authorize('ADMIN'), checkSubscription, (req, res, next) => tablesController.regenerateQr(req, res, next));

export default router;
