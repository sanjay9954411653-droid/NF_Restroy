import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authenticate';
import { getMenuOtpPhone, isMenuTokenValid } from '@/modules/menuAccess/menuAccess.service';

/**
 * Blocks menu changes for ADMIN users until they have verified an OTP,
 * but only when the restaurant has a menu security phone number set.
 */
export const requireMenuOtp = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user || req.user.role !== 'ADMIN') return next();
    const phone = await getMenuOtpPhone(req.user.restaurantId);
    if (!phone) return next();
    if (isMenuTokenValid(req.header('x-menu-token') || undefined, req.user.userId, req.user.restaurantId)) return next();
    res.status(403).json({ success: false, error: { code: 'MENU_OTP_REQUIRED', message: 'Menu is locked. Verify the OTP sent to the admin phone first.' } });
  } catch (err) {
    next(err);
  }
};
