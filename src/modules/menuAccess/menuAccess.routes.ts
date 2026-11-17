import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthenticatedRequest } from '@/shared/middleware/authenticate';
import { authorize } from '@/shared/middleware/authorize';
import { successResponse } from '@/shared/utils/responseHandler';
import { menuAccessService, OtpScope } from './menuAccess.service';

const router = Router();
type H = (req: AuthenticatedRequest, res: Response) => Promise<void>;
const wrap = (fn: H) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);
const menuToken = (req: AuthenticatedRequest) => req.header('x-menu-token') || undefined;
const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });

router.use(authenticate, authorize('ADMIN'));

// Same endpoints for both locks: /menu-access/<status|request-otp|verify> and /menu-access/records/<…>
const mountScope = (prefix: string, scope: OtpScope, header: string) => {
  const tok = (req: AuthenticatedRequest) => req.header(header) || undefined;
  router.get(`${prefix}/status`, wrap(async (req, res) => {
    res.json(successResponse(await menuAccessService.status(req.user!.userId, req.user!.restaurantId, tok(req), scope)));
  }));
  router.post(`${prefix}/request-otp`, wrap(async (req, res) => {
    res.json(successResponse(await menuAccessService.requestOtp(req.user!.userId, req.user!.restaurantId, scope)));
  }));
  router.post(`${prefix}/verify`, wrap(async (req, res) => {
    const { code } = codeSchema.parse(req.body);
    res.json(successResponse(await menuAccessService.verify(req.user!.userId, req.user!.restaurantId, code, scope)));
  }));
};
mountScope('', 'menu', 'x-menu-token');
mountScope('/records', 'records', 'x-records-token');

router.put('/email', wrap(async (req, res) => {
  const { email } = z.object({ email: z.string().max(255) }).parse(req.body);
  res.json(successResponse(await menuAccessService.setEmail(req.user!.userId, req.user!.restaurantId, email, menuToken(req))));
}));

export default router;
