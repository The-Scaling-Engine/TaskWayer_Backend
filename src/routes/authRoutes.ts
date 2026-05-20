import { Router } from 'express';
import { forgotPassword } from '../controllers/authController';
import { validateRequest } from '../middleware/validateRequest';
import { forgotPasswordSchema } from '../schemas/authSchemas';

const router = Router();

// POST /api/auth/forgot-password — public, rate-limited at server level (authLimiter)
router.post(
  '/forgot-password',
  validateRequest({ body: forgotPasswordSchema }),
  forgotPassword
);

export default router;
