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
  '20260518000000_supabase_auth_migration',
  '20260519000000_add_recurring_task_fields',
  '20260519100000_rename_deadline_notification_types',
  '20260520085406_add_scheduled_at',
  '20260520200727_add_pending_user_status',
  '20260522095646_add_todo_model',
  '20260523111102_add_todo_tags_and_order',
  '20260523161110_add_task_assignment',
  '20260523185858_add_dept_member_joined_notification',
  '20260527073304_add_project_model',
  '20260527084418_harden_project_roles_and_softdelete',
  '20260527112053_add_task_note_model',
  '20260527153508_add_task_note_done_order',
  '20260527162125_add_note_added_notification_type',
  '20260527164225_add_note_added_and_project_member_joined',
  '20260527175750_add_board_column_model',
  '20260528092653_extend_recurrence_frequency',
  '20260528101029_add_recurrence_interval',
  '20260528124054_add_project_slack_config',
  '20260528172303_one_active_dept_per_user',
  '20260531000000_drop_task_departmentid_isassigned',
  '20260601000000_drop_one_active_dept_per_user_index',
  '20260602105918_add_milestone_planning_fields',
  '20260603144942_add_slack_config_phase7',
  '20260604124152_add_slack_config_webhook_extensions',
  '20260604150000_add_webhook_secret_unique_index',
  '20260613142503_add_estimated_hours_to_task',
  '20260624000000_add_manager_role',
];

const isWin = process.platform === 'win32';

function runCommand(args) {
  const result = spawnSync('npx', args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    encoding: 'utf8',
    shell: true,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return { status: result.status, out: (result.stdout || '') + (result.stderr || '') };
}

function runMigrateDeploy() {
  const { status, out } = runCommand(['prisma', 'migrate', 'deploy']);
  if (status === 0) return 'ok';
  if (out.includes('P3005')) return 'p3005';
  if (out.includes('P3009')) {
    // Extract failed migration name from error output
    const match = out.match(/The `([^`]+)` migration started at .+ failed/);
    return match ? `p3009:${match[1]}` : 'p3009:unknown';
  }
  throw new Error(`prisma migrate deploy failed (exit ${status})\n${out}`);
}

function baseline() {
  console.log('[deploy] P3005 detected — baselining existing database...');
  for (const name of MIGRATIONS) {
    const { status, out } = runCommand(['prisma', 'migrate', 'resolve', '--applied', name]);
    if (status === 0) {
      console.log(`[deploy] Baselined: ${name}`);
    } else {
      console.warn(`[deploy] Warning for ${name}: ${out.trim()}`);
    }
  }
}

function resolveFailedMigration(name) {
  console.log(`[deploy] P3009 detected — resolving failed migration: ${name}`);
  const { status, out } = runCommand(['prisma', 'migrate', 'resolve', '--rolled-back', name]);
  if (status !== 0) {
    throw new Error(`Failed to resolve migration ${name}: ${out}`);
  }
  console.log(`[deploy] Rolled back: ${name}`);
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
  let status = runMigrateDeploy();

  if (status === 'p3005') {
    baseline();
    console.log('[deploy] Retrying prisma migrate deploy...');
    status = runMigrateDeploy();
  }

  if (typeof status === 'string' && status.startsWith('p3009:')) {
    const failedName = status.slice('p3009:'.length);
    if (failedName === 'unknown') {
      throw new Error('[deploy] P3009: could not parse failed migration name from output.');
    }
    resolveFailedMigration(failedName);
    console.log('[deploy] Retrying prisma migrate deploy...');
    status = runMigrateDeploy();
  }

  if (status !== 'ok') {
    console.error('[deploy] Migration failed. Aborting.');
    process.exit(1);
  }

  startServer();
})();
