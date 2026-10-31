import { Router } from 'express';
import { subscriptionsController } from './subscriptions.controller';
import { authenticate } from '@/shared/middleware/authenticate';
import { authorize } from '@/shared/middleware/authorize';

const router = Router();

// List current restaurant's invoices (any authenticated user can view)
router.get('/', authenticate, (req, res, next) =>
  subscriptionsController.getInvoices(req, res, next),
);

// NOTE: restaurants can only VIEW invoices. Creating invoices and marking them
// paid is platform-owner-only (see /subscriptions/admin/* and
// /subscriptions/invoices/:id/mark-paid) — otherwise a restaurant could mark its
// own bill paid and keep its account active for free.

export default router;
