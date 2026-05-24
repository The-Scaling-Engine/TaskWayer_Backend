import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { upload, uploadFile, handleMulterError } from '../controllers/uploadController';

const router = Router();

router.post('/', protect, upload.single('file'), uploadFile, handleMulterError);

export default router;
