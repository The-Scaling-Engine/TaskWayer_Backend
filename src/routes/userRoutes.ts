import { Router } from 'express';
import { getProfile, updateProfile, getMyMemberships, searchUsers } from '../controllers/userController';
import { protect } from '../middleware/authMiddleware';
import { validateRequest } from '../middleware/validateRequest';
import { updateProfileSchema } from '../schemas/userSchemas';

const router = Router();

router.use(protect);

// GET /api/user/profile
router.get('/profile', getProfile);

// PUT /api/user/profile
router.put('/profile', validateRequest({ body: updateProfileSchema }), updateProfile);

// GET /api/user/memberships
router.get('/memberships', getMyMemberships);

// GET /api/user/search?q=&limit=
router.get('/search', searchUsers);

export default router;
