import { Profile, Department, Task, Todo, DepartmentMember, DepartmentInvitation, DepartmentMemberRole, MembershipStatus, Comment, Notification, NotificationType, RecurrenceType } from '@prisma/client';

// ─── Profile DTOs ─────────────────────────────────────────────

export interface CreateProfileData {
  email: string;
  name?: string;
  avatar?: string;
  passwordHash: string;
  role?: 'USER' | 'ADMIN' | 'DEPT_MANAGER' | 'DEPT_MEMBER';
  mongoId?: string;
}

export interface UpdateProfileData {
  name?: string;
  avatar?: string;
  role?: 'USER' | 'ADMIN' | 'DEPT_MANAGER' | 'DEPT_MEMBER';
  status?: 'ACTIVE' | 'BANNED';
  passwordHash?: string;
  passwordResetToken?: string | null;
  passwordResetExpires?: Date | null;
}

// ─── Department DTOs ──────────────────────────────────────────

export interface CreateDepartmentData {
  name: string;
  description?: string;
}

export interface UpdateDepartmentData {
  name?: string;
  description?: string;
}

// ─── Membership DTOs ──────────────────────────────────────────

export interface MemberWithProfile {
  id: string;
  userId: string;
  departmentId: string;
  role: DepartmentMemberRole;
  status: MembershipStatus;
  joinedAt: Date;
  invitedBy: string | null;
  profile: {
    id: string;
    email: string;
    name: string | null;
    username: string | null;
    avatar: string | null;
    jobTitle: string | null;
  };
}

export interface CreateMembershipData {
  userId: string;
  departmentId: string;
  role?: DepartmentMemberRole;
  invitedBy?: string;
  status?: MembershipStatus;
}

export interface UpdateMembershipData {
  role?: DepartmentMemberRole;
  status?: MembershipStatus;
}

// ─── Department Shape (with memberships) ─────────────────────

export interface DepartmentWithMembers {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  memberships: MemberWithProfile[];
  hasMoreMembers: boolean;
  _count?: {
    memberships: number;
  };
}

export interface PaginatedDepartmentsResult {
  departments: DepartmentWithMembers[];
  total: number;
  page: number;
  limit: number;
}

export interface PaginatedMembersResult {
  members: MemberWithProfile[];
  total: number;
  page: number;
  limit: number;
}

// ─── Invitation DTOs ─────────────────────────────────────────

export interface CreateInvitationData {
  departmentId: string;
  email: string;
  role: DepartmentMemberRole;
  token: string;
  invitedBy: string;
  expiresAt: Date;
}

export interface InvitationWithInviter {
  id: string;
  departmentId: string;
  email: string;
  role: DepartmentMemberRole;
  token: string;
  invitedBy: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
  inviter: {
    id: string;
    name: string | null;
    email: string;
  };
}

export interface PaginatedInvitationsResult {
  invitations: InvitationWithInviter[];
  total: number;
  page: number;
  limit: number;
}

// ─── Comment DTOs ─────────────────────────────────────────────

export interface CreateCommentData {
  taskId: string;
  authorId: string;
  content: string;
  parentId?: string;
}

export interface UpdateCommentData {
  content: string;
}

export interface CommentAuthor {
  id: string;
  name: string | null;
  username: string | null;
  avatar: string | null;
}

export interface CommentWithAuthor {
  id: string;
  taskId: string;
  authorId: string;
  content: string;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  author: CommentAuthor;
  replies?: CommentWithAuthor[];
}

// Returned by findByTask — parent comments always carry reply metadata
export interface CommentWithReplies extends Omit<CommentWithAuthor, 'replies'> {
  replies: CommentWithAuthor[];
  totalReplies: number;
  hasMoreReplies: boolean;
}

export interface ICommentRepository {
  findById(id: string): Promise<Comment | null>;
  findByTask(taskId: string, page: number, limit: number): Promise<{ comments: CommentWithReplies[]; total: number }>;
  findParentById(id: string): Promise<Comment | null>;
  create(data: CreateCommentData): Promise<Comment>;
  update(id: string, data: UpdateCommentData): Promise<Comment>;
  softDelete(id: string): Promise<Comment>;
}

// ─── Notification DTOs ────────────────────────────────────────

export interface CreateNotificationData {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
  entityType?: string;
  entityId?: string;
}

export interface INotificationRepository {
  findByUser(userId: string, page: number, limit: number, unreadOnly?: boolean): Promise<{ notifications: Notification[]; total: number }>;
  countUnread(userId: string): Promise<number>;
  create(data: CreateNotificationData): Promise<Notification>;
  markRead(id: string, userId: string): Promise<Notification | null>;
  markAllRead(userId: string): Promise<number>;
}

// ─── Task DTOs ────────────────────────────────────────────────

export interface CreateTaskData {
  title: string;
  description?: string;
  status?: 'todo' | 'doing' | 'done';
  priority?: 'low' | 'medium' | 'high';
  tags?: string[];
  deadline?: Date;
  scheduledAt?: Date | null;
  completedAt?: Date;
  profileId: string;
  projectId?: string;
  columnId?: string;
  mongoId?: string;
  isRecurring?: boolean;
  recurrenceType?: RecurrenceType;
  recurrenceInterval?: number | null;
  recurrenceEndDate?: Date | null;
  recurrenceParentId?: string;
  assignedTo?: string;
  assignedBy?: string;
}

export interface UpdateTaskData {
  title?: string;
  description?: string;
  status?: 'todo' | 'doing' | 'done';
  priority?: 'low' | 'medium' | 'high';
  tags?: string[];
  deadline?: Date | null;
  scheduledAt?: Date | null;
  completedAt?: Date | null;
  columnId?: string | null;
  isRecurring?: boolean;
  recurrenceType?: RecurrenceType | null;
  recurrenceInterval?: number | null;
  recurrenceEndDate?: Date | null;
  assignedTo?: string | null;
  assignedBy?: string | null;
}

export interface TaskFilterOptions {
  status?: string;
  priority?: string;
  tag?: string;
  search?: string;
  deadlineFrom?:   string;
  deadlineTo?:     string;
  createdFrom?:    string;
  createdTo?:      string;
  scheduledFrom?:  string;
  scheduledTo?:    string;
  personal?:       boolean;
  assignedByMe?:   boolean;
  assignedToMe?:   boolean;
  projectId?:      string;
}

export interface TaskSortOptions {
  sortBy?: 'deadline' | 'createdAt' | 'priority' | 'status' | 'title';
  order?: 'asc' | 'desc';
}

export interface TaskPaginationOptions {
  page?: number;
  limit?: number;
}

export interface FindManyPaginatedOptions {
  profileId: string;
  filter?: TaskFilterOptions;
  sort?: TaskSortOptions;
  pagination?: TaskPaginationOptions;
  scopeFilter?: import('@prisma/client').Prisma.TaskWhereInput;
}

export interface PaginatedTasksResult {
  tasks: Task[];
  total: number;
  page: number;
  limit: number;
}

export interface TaskStatsResult {
  total: number;
  todo: number;
  doing: number;
  done: number;
}

export interface WorkloadTaskStats {
  total: number;
  todo: number;
  doing: number;
  done: number;
  overdue: number;
  highPriority: number;
  nearDeadline: number;
}

export interface MemberTaskFilterOptions {
  status?: 'todo' | 'doing' | 'done';
  priority?: 'low' | 'medium' | 'high';
  deadlineBefore?: string;
}

// ─── Todo DTOs ────────────────────────────────────────────────

export interface CreateTodoData {
  profileId: string;
  text: string;
  tags?: string[];
  order?: number;
}

export interface UpdateTodoData {
  text?: string | undefined;
  done?: boolean | undefined;
  tags?: string[] | undefined;
}

export interface ITodoRepository {
  findById(id: string): Promise<Todo | null>;
  findByProfile(profileId: string): Promise<Todo[]>;
  create(data: CreateTodoData): Promise<Todo>;
  update(id: string, data: UpdateTodoData): Promise<Todo>;
  reorder(items: { id: string; order: number }[], profileId: string): Promise<void>;
  delete(id: string): Promise<void>;
}

// ─── Repository Interfaces ────────────────────────────────────

export interface IProfileRepository {
  findById(id: string): Promise<Profile | null>;
  findByEmail(email: string): Promise<Profile | null>;
  findByMongoId(mongoId: string): Promise<Profile | null>;
  findByUsername(username: string): Promise<Profile | null>;
  create(data: CreateProfileData): Promise<Profile>;
  update(id: string, data: UpdateProfileData): Promise<Profile>;
}

export interface IDepartmentRepository {
  findById(id: string): Promise<Department | null>;
  findByName(name: string): Promise<Department | null>;
  findAll(): Promise<Department[]>;
  findWithMembers(id: string): Promise<DepartmentWithMembers | null>;
  findAllWithCount(page: number, limit: number): Promise<PaginatedDepartmentsResult>;
  findByUserRole(userId: string, roles: string[]): Promise<{ id: string; name: string }[]>;
  create(data: CreateDepartmentData): Promise<Department>;
  update(id: string, data: UpdateDepartmentData): Promise<Department>;
  delete(id: string): Promise<Department>;
}

export interface IMembershipRepository {
  findById(id: string): Promise<DepartmentMember | null>;
  findByUserAndDepartment(userId: string, departmentId: string): Promise<DepartmentMember | null>;
  getActiveMemberRole(userId: string, departmentId: string): Promise<DepartmentMemberRole | null>;
  findActiveMembersByDepartment(departmentId: string, page: number, limit: number): Promise<PaginatedMembersResult>;
  findUserMemberships(userId: string): Promise<(DepartmentMember & { department: Department })[]>;
  findActiveMembershipsByUser(userId: string): Promise<Array<DepartmentMember & { department: { id: string; name: string } }>>;
  create(data: CreateMembershipData): Promise<DepartmentMember>;
  update(id: string, data: UpdateMembershipData): Promise<DepartmentMember>;
  delete(id: string): Promise<void>;
  countActive(departmentId: string): Promise<number>;
}

export interface IInvitationRepository {
  findByToken(token: string): Promise<DepartmentInvitation | null>;
  findById(id: string): Promise<DepartmentInvitation | null>;
  findActiveByDepartmentAndEmail(departmentId: string, email: string): Promise<DepartmentInvitation | null>;
  findPendingByDepartment(departmentId: string, page: number, limit: number): Promise<PaginatedInvitationsResult>;
  create(data: CreateInvitationData): Promise<DepartmentInvitation>;
  markAccepted(id: string): Promise<DepartmentInvitation>;
  delete(id: string): Promise<void>;
}

export interface ITaskRepository {
  findById(id: string): Promise<Task | null>;
  findByIdOrMongoId(id: string): Promise<Task | null>;
  findByProfile(profileId: string): Promise<Task[]>;
  findManyPaginated(options: FindManyPaginatedOptions): Promise<PaginatedTasksResult>;
  getMemberTasksInDepartment(profileId: string, departmentId: string, filter: MemberTaskFilterOptions, page: number, limit: number): Promise<PaginatedTasksResult>;
  getWorkloadByMemberIds(memberIds: string[], departmentId: string): Promise<Map<string, WorkloadTaskStats>>;
  create(data: CreateTaskData): Promise<Task>;
  createMany(data: CreateTaskData[]): Promise<void>;
  bulkCreate(data: CreateTaskData[]): Promise<Task[]>;
  update(id: string, data: UpdateTaskData): Promise<Task>;
  delete(id: string): Promise<void>;
  deleteManyByParentId(parentId: string): Promise<number>;
  deleteManyByParentIdFromDate(parentId: string, fromDate: Date): Promise<number>;
  count(profileId: string): Promise<number>;
  statsByStatus(profileId: string): Promise<TaskStatsResult>;
}
