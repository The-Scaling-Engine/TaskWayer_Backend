'use strict';
const { spawnSync, spawn } = require('child_process');

const MIGRATIONS = [
  '20260509183900_init_phase1_schema',
  '20260512120000_fix_enum_case_and_missing_indexes',
  '20260512181931_phase2_department_membership_rbac',
  '20260513070056_drop_profile_legacy_department_id',
  '20260513145433_phase3_comments_notifications',
  '20260514120000_add_query_hardening_indexes',
  '20260514140000_add_task_completed_at',
  '20260514160000_add_time_tracking_sessions',
  '20260514180000_add_job_title_to_profile',
];

const isWin = process.platform === 'win32';

function runMigrateDeploy() {
  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    encoding: 'utf8',
    shell: isWin,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status === 0) return 'ok';

  const out = (result.stdout || '') + (result.stderr || '');
  if (out.includes('P3005')) return 'p3005';

  throw new Error(`prisma migrate deploy failed (exit ${result.status})`);
}

function baseline() {
  console.log('[deploy] P3005 detected — baselining existing database...');
  for (const name of MIGRATIONS) {
    const result = spawnSync('npx', ['prisma', 'migrate', 'resolve', '--applied', name], {
      stdio: ['inherit', 'pipe', 'pipe'],
      encoding: 'utf8',
      shell: isWin,
    });
    if (result.status === 0) {
      console.log(`[deploy] Baselined: ${name}`);
    } else {
      const out = ((result.stdout || '') + (result.stderr || '')).trim();
      console.warn(`[deploy] Warning for ${name}: ${out}`);
    }
  }
}

function startServer() {
  console.log('[deploy] Starting server...');
  const server = spawn(process.execPath, ['dist/server.js'], { stdio: 'inherit' });

  ['SIGTERM', 'SIGINT'].forEach((sig) => {
    process.on(sig, () => server.kill(sig));
  });

  server.on('exit', (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
}

(function main() {
  console.log('[deploy] Running prisma migrate deploy...');
  const status = runMigrateDeploy();

  if (status === 'p3005') {
    baseline();
    console.log('[deploy] Retrying prisma migrate deploy...');
    const retry = runMigrateDeploy();
    if (retry !== 'ok') {
      console.error('[deploy] Migration failed after baselining. Aborting.');
      process.exit(1);
    }
  }

  startServer();
})();
