import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthenticatedRequest } from '@/shared/middleware/authenticate';
import { authorize } from '@/shared/middleware/authorize';
import { successResponse } from '@/shared/utils/responseHandler';
import { BadRequestError, UnauthorizedError } from '@/shared/errors/AppError';
import { printingRepository } from './printing.repository';
import { printingService } from './printing.service';

const router = Router();

// ── Restaurant admin: turn the bridge on/off, see its key and status ─────────
router.get('/settings', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = req.user!.restaurantId;
    const s = (await printingRepository.getSettings(restaurantId)) ?? (await printingRepository.upsertSettings(restaurantId, {}));
    const recent = await printingRepository.recent(restaurantId, 10);
    const online = !!s.last_seen_at && Date.now() - new Date(s.last_seen_at).getTime() < 15000;
    res.json(successResponse({ ...s, bridge_online: online, recent_jobs: recent }));
  } catch (e) { next(e); }
});

const SettingsSchema = z.object({ enabled: z.boolean().optional(), auto_kot: z.boolean().optional() });
router.put('/settings', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const patch = SettingsSchema.parse(req.body);
    res.json(successResponse(await printingRepository.upsertSettings(req.user!.restaurantId, patch)));
  } catch (e) { next(e); }
});

router.post('/settings/rotate-key', authenticate, authorize('ADMIN'), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    res.json(successResponse(await printingRepository.rotateKey(req.user!.restaurantId), { message: 'New key created. Update the bridge config.' }));
  } catch (e) { next(e); }
});

// ── Staff: queue ready-made bytes (receipts / manual KOT reprints from the browser) ──
const RawSchema = z.object({
  target: z.enum(['KOT', 'BILL']),
  data_base64: z.string().min(1).max(400_000),
});
router.post('/jobs/raw', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = req.user!.restaurantId;
    const { target, data_base64 } = RawSchema.parse(req.body);
    const settings = await printingRepository.getSettings(restaurantId);
    if (!settings?.enabled) throw new BadRequestError('Print bridge is not enabled for this restaurant');
    const id = await printingService.enqueueRaw(restaurantId, target, data_base64);
    res.status(201).json(successResponse({ id }));
  } catch (e) { next(e); }
});

// ── The bridge program (logs in with the secret key, no user account) ─────────
interface BridgeRequest extends Request { bridgeRestaurantId?: string }

async function bridgeAuth(req: BridgeRequest, _res: Response, next: NextFunction): Promise<void> {
  try {
    const key = req.header('x-bridge-key');
    if (!key) throw new UnauthorizedError('Missing bridge key');
    const s = await printingRepository.findByKey(key);
    if (!s) throw new UnauthorizedError('Invalid bridge key');
    if (!s.enabled) throw new UnauthorizedError('Print bridge is turned off for this restaurant');
    req.bridgeRestaurantId = s.restaurant_id;
    next();
  } catch (e) { next(e); }
}

router.post('/bridge/claim', bridgeAuth, async (req: BridgeRequest, res: Response, next: NextFunction) => {
  try {
    const restaurantId = req.bridgeRestaurantId!;
    await printingRepository.touchSeen(restaurantId);
    const jobs = await printingRepository.claim(restaurantId, 10);
    res.json(successResponse({ jobs }));
  } catch (e) { next(e); }
});

const ResultSchema = z.object({ ok: z.boolean(), error: z.string().max(500).optional() });
router.post('/bridge/jobs/:id/result', bridgeAuth, async (req: BridgeRequest, res: Response, next: NextFunction) => {
  try {
    const { ok, error } = ResultSchema.parse(req.body);
    const found = await printingRepository.complete(req.bridgeRestaurantId!, req.params.id, ok, error);
    res.json(successResponse({ updated: found }));
  } catch (e) { next(e); }
});

export default router;
