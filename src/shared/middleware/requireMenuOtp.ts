import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authenticate';
import { getMenuOtpEmail, isMenuTokenValid } from '@/modules/menuAccess/menuAccess.service';

/**
 * Blocks menu changes for ADMIN users until they have verified an OTP,
 * but only when the restaurant has a menu security email set.
 */
export const requireMenuOtp = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user || req.user.role !== 'ADMIN') return next();
    const email = await getMenuOtpEmail(req.user.restaurantId);
    if (!email) return next();
    if (isMenuTokenValid(req.header('x-menu-token') || undefined, req.user.userId, req.user.restaurantId)) return next();
    res.status(403).json({ success: false, error: { code: 'MENU_OTP_REQUIRED', message: 'Menu is locked. Verify the OTP sent to the admin email first.' } });
  } catch (err) {
    next(err);
  }
};
