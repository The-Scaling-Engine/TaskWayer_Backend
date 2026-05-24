import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import { upload, uploadFile } from '../controllers/uploadController';

const router = Router();

router.post('/', protect, upload.single('file'), uploadFile);

export default router;
