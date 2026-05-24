import type { Response } from 'express';
import multer from 'multer';
import supabaseAdmin from '../config/supabase';
import type { AuthRequest } from '../middleware/authMiddleware';
import { sendError } from '../utils/apiResponse';
import logger from '../config/logger';

const BUCKET = 'task-attachments';

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only images (JPEG, PNG, GIF, WEBP) and PDF files are allowed'));
  },
});

export const uploadFile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      sendError(res, req, 400, 'BAD_REQUEST', 'No file provided');
      return;
    }

    const { originalname, buffer, mimetype } = req.file;
    const ext = originalname.split('.').pop() ?? 'bin';
    const path = `${req.user!.prismaId}/${Date.now()}.${ext}`;

    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: mimetype, upsert: false });

    if (error) throw error;

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from(BUCKET)
      .getPublicUrl(path);

    res.status(200).json({ success: true, url: publicUrl });
  } catch (err) {
    logger.error({ err }, 'uploadFile failed');
    sendError(res, req, 500, 'UPLOAD_FAILED', 'File upload failed');
  }
};
