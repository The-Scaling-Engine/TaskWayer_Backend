import { DepartmentMemberRole } from '@prisma/client';
import { PrismaMembershipRepository } from '../repositories/prisma/membershipRepository';
import { PrismaTaskRepository } from '../repositories/prisma/taskRepository';
import {
  getActiveSessionsByProfileIds,
  getActiveSessionWithTask,
  ActiveSessionWithTask,
} from '../repositories/prisma/timeTrackingRepository';
import { MemberTaskFilterOptions, WorkloadTaskStats, PaginatedTasksResult } from '../repositories/interfaces';
import { ServiceError } from './departmentService';

const membershipRepo = new PrismaMembershipRepository();
const taskRepo = new PrismaTaskRepository();

// ─── Types ───────────────────────────────────────────────────

export interface MemberWorkload {
  memberId: string;
  profile: {
    id: string;
    name: string | null;
    email: string;
    username: string | null;
    avatar: string | null;
    jobTitle: string | null;
  };
  role: DepartmentMemberRole;
  tasks: WorkloadTaskStats;
  hasActiveSession: boolean;
  isOverloaded: boolean;
}

export interface DepartmentWorkloadResult {
  members: MemberWorkload[];
  total: number;
  page: number;
  limit: number;
}

export interface MemberActiveSessionResult {
  hasActiveSession: boolean;
  session: ActiveSessionWithTask | null;
}

const OVERLOAD_HOURS_THRESHOLD = 40;
const OVERLOAD_TASKS_THRESHOLD = 8;

const EMPTY_STATS: WorkloadTaskStats = {
  total: 0, todo: 0, doing: 0, done: 0,
  overdue: 0, highPriority: 0, nearDeadline: 0, totalEstimatedHours: 0,
};

// ─── Service Functions ────────────────────────────────────────

export const getDepartmentWorkload = async (
  departmentId: string,
  page: number,
  limit: number
): Promise<DepartmentWorkloadResult> => {
  const { members, total } = await membershipRepo.findActiveMembersByDepartment(departmentId, page, limit);

  const profileIds = members.map(m => m.userId);

  const [workloadMap, sessionsMap] = await Promise.all([
    taskRepo.getWorkloadByMemberIds(profileIds, departmentId),
    getActiveSessionsByProfileIds(profileIds),
  ]);

  const result: MemberWorkload[] = members.map(m => {
    const tasks = workloadMap.get(m.userId) ?? EMPTY_STATS;
    const isOverloaded =
      tasks.totalEstimatedHours > OVERLOAD_HOURS_THRESHOLD ||
      tasks.doing > OVERLOAD_TASKS_THRESHOLD;
    return {
      memberId: m.id,
      profile: m.profile,
      role: m.role,
      tasks,
      hasActiveSession: sessionsMap.has(m.userId),
      isOverloaded,
    };
  });

  return { members: result, total, page, limit };
};

export const getMemberTasksInDepartment = async (
  departmentId: string,
  targetUserId: string,
  filter: MemberTaskFilterOptions,
  page: number,
  limit: number
): Promise<PaginatedTasksResult> => {
  const role = await membershipRepo.getActiveMemberRole(targetUserId, departmentId);
  if (role === null) throw new ServiceError('Member not found in this department', 404);

  return taskRepo.getMemberTasksInDepartment(targetUserId, departmentId, filter, page, limit);
};

export const getMemberActiveSession = async (
  departmentId: string,
  targetUserId: string
): Promise<MemberActiveSessionResult> => {
  const role = await membershipRepo.getActiveMemberRole(targetUserId, departmentId);
  if (role === null) throw new ServiceError('Member not found in this department', 404);

  const session = await getActiveSessionWithTask(targetUserId);
  return { hasActiveSession: session !== null, session };
};
