import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { upload, uploadFile, handleMulterError } from '../controllers/uploadController';

const router = Router();

router.post('/', protect, upload.single('file'), uploadFile);
router.use(handleMulterError);

export default router;
