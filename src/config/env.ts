import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV:                   z.enum(['development', 'production', 'test']).default('development'),
  PORT:                       z.coerce.number().int().positive().max(65535).default(3000),
  DATABASE_URL:               z.string().min(1, 'DATABASE_URL is required'),
  FRONTEND_URL:               z
    .string()
    .default('http://localhost:5173')
    .transform(val => val.split(',').map(u => u.trim().replace(/\/$/, '')).filter(Boolean)),
  CLIENT_URL:                 z.string().min(1, 'CLIENT_URL is required'),
  // Supabase
  SUPABASE_URL:               z.string().min(1, 'SUPABASE_URL is required'),
  SUPABASE_SERVICE_ROLE_KEY:  z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  // Resend email
  RESEND_API_KEY:             z.string().min(1, 'RESEND_API_KEY is required'),
  EMAIL_FROM:                 z.string().min(1, 'EMAIL_FROM is required'),
  // Groq AI
  GROQ_API_KEY:               z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

const result = envSchema.safeParse(process.env);
if (!result.success) {
  const issues = result.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  process.stderr.write(`\n[FATAL] Invalid environment configuration:\n${issues}\n\n`);
  process.exit(1);
}

export const env: Env = result.data;
