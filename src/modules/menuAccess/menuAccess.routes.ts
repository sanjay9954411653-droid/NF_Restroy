import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthenticatedRequest } from '@/shared/middleware/authenticate';
import { authorize } from '@/shared/middleware/authorize';
import { successResponse } from '@/shared/utils/responseHandler';
import { menuAccessService } from './menuAccess.service';

const router = Router();
const token = (req: AuthenticatedRequest) => req.header('x-menu-token') || undefined;
type H = (req: AuthenticatedRequest, res: Response) => Promise<void>;
const wrap = (fn: H) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(authenticate, authorize('ADMIN'));

router.get('/status', wrap(async (req, res) => {
  res.json(successResponse(await menuAccessService.status(req.user!.userId, req.user!.restaurantId, token(req))));
}));

router.post('/request-otp', wrap(async (req, res) => {
  res.json(successResponse(await menuAccessService.requestOtp(req.user!.userId, req.user!.restaurantId)));
}));

router.post('/verify', wrap(async (req, res) => {
  const { code } = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }).parse(req.body);
  res.json(successResponse(await menuAccessService.verify(req.user!.userId, req.user!.restaurantId, code)));
}));

router.put('/email', wrap(async (req, res) => {
  const { email } = z.object({ email: z.string().max(255) }).parse(req.body);
  res.json(successResponse(await menuAccessService.setEmail(req.user!.userId, req.user!.restaurantId, email, token(req))));
}));

export default router;
