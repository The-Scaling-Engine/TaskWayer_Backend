import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import type { OpenAPIObjectConfig } from '@asteasolutions/zod-to-openapi/dist/v3.0/openapi-generator';
import { registry } from './registry';

// ── Register all components and paths (side-effect imports) ──
import './components';
import './routes/generalRoutes';
import './routes/authRoutes';
import './routes/taskRoutes';
import './routes/userRoutes';
import './routes/adminRoutes';
import './routes/departmentRoutes';
import './routes/commentRoutes';
import './routes/notificationRoutes';
import './routes/analyticsRoutes';
import './routes/adminAnalyticsRoutes';
import './routes/timeTrackingRoutes';
import './routes/todoRoutes';

const docConfig: OpenAPIObjectConfig = {
  openapi: '3.0.0',
  info: {
    title: 'MicroDo API',
    version: '1.0.0',
    description:
      'Complete API documentation for MicroDo — a task management backend with analytics, ' +
      'time tracking, department management, and real-time notifications.\n\n' +
      '**Authentication:** Click **Authorize** and enter your JWT token (without "Bearer " prefix).\n\n' +
      '**Rate limits:** Auth endpoints: 10 req/min. Analytics/time-tracking: 30 req/min. ' +
      'Department writes: 20 req/min.',
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Local development server' },
  ],
  tags: [
    { name: 'General',            description: 'Health checks and root endpoints' },
    { name: 'Auth',               description: 'Registration, login, and password management' },
    { name: 'User',               description: 'Current user profile management' },
    { name: 'Tasks',              description: 'Task CRUD and statistics for the authenticated user' },
    { name: 'Comments',          description: 'Task comment threads' },
    { name: 'Notifications',     description: 'In-app notifications for the authenticated user' },
    { name: 'Analytics',         description: 'Personal task analytics and time tracking stats' },
    { name: 'Time Tracking',     description: 'Time tracking sessions for tasks' },
    { name: 'Admin',             description: 'User management — Admin role required' },
    { name: 'Admin Departments', description: 'Department CRUD — Admin role required' },
    { name: 'Department Members', description: 'Department membership and ownership management' },
    { name: 'Invitations',       description: 'Department invitations (send, accept, reject)' },
    { name: 'Admin Analytics',   description: 'System-wide analytics — Admin role required' },
    { name: 'Todos',             description: 'Quick todo list items for the authenticated user' },
  ],
};

let cachedSpec: ReturnType<OpenApiGeneratorV3['generateDocument']> | null = null;

export function generateOpenApiDocument() {
  if (cachedSpec !== null) return cachedSpec;
  const generator = new OpenApiGeneratorV3(registry.definitions);
  cachedSpec = generator.generateDocument(docConfig);
  return cachedSpec;
}
