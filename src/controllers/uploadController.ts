import type { Response, NextFunction } from 'express';
import multer from 'multer';
import supabaseAdmin from '../config/supabase';
import type { AuthRequest } from '../middleware/authMiddleware';
import { sendError } from '../utils/apiResponse';
import logger from '../config/logger';

const BUCKET = 'task-attachments';

const ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
];

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only images (JPEG, PNG, GIF, WEBP) and PDF files are allowed'));
  },
});

/** Catch multer errors (file size / type) and return 400 instead of 500 */
export const handleMulterError = (
  err: unknown,
  _req: AuthRequest,
  res: Response,
  next: NextFunction,
): void => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? 'File is too large. Maximum size is 10 MB.'
      : err.message;
    res.status(400).json({ success: false, message: msg });
    return;
  }
  if (err instanceof Error) {
    res.status(400).json({ success: false, message: err.message });
    return;
  }
  next(err);
};

/** Ensure the storage bucket exists (auto-creates on first upload) */
async function ensureBucket(): Promise<void> {
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ['image/*', 'application/pdf'],
  });
  // Ignore "already exists" — that's fine
  if (error && !error.message.toLowerCase().includes('already exist')) {
    throw error;
  }
}

export const uploadFile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      sendError(res, req, 400, 'BAD_REQUEST', 'No file provided');
      return;
    }

    await ensureBucket();

    const { originalname, buffer, mimetype } = req.file;
    const ext = originalname.split('.').pop() ?? 'bin';
    const filePath = `${req.user!.prismaId}/${Date.now()}.${ext}`;

    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(filePath, buffer, { contentType: mimetype, upsert: false });

    if (error) {
      logger.error({ err: error }, 'Supabase storage upload error');
      sendError(res, req, 500, 'UPLOAD_FAILED', `Storage error: ${error.message}`);
      return;
    }

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from(BUCKET)
      .getPublicUrl(filePath);

    res.status(200).json({ success: true, url: publicUrl });
  } catch (err) {
    logger.error({ err }, 'uploadFile failed');
    sendError(res, req, 500, 'UPLOAD_FAILED', 'File upload failed');
  }
};
