import { boardColumnRepository } from '../repositories/prisma/boardColumnRepository';
import { projectRepository, MANAGER_ROLES } from '../repositories/prisma/projectRepository';
import { ServiceError } from './departmentService';
import { assertProjectReadable } from './projectService';

// ─── Permission helpers ───────────────────────────────────────


async function assertManager(projectId: string, profileId: string) {
  const member = await projectRepository.getMember(projectId, profileId);
  if (!member) throw new ServiceError('Access denied: not a project member', 403);
  if (!MANAGER_ROLES.includes(member.role)) {
    throw new ServiceError('Only OWNER or MANAGER can manage columns', 403);
  }
  return member;
}

// ─── Service ─────────────────────────────────────────────────

export const getColumns = async (projectId: string, requesterId: string) => {
  await assertProjectReadable(projectId, requesterId);
  let columns = await boardColumnRepository.getColumnsByProjectId(projectId);

  if (columns.length === 0) {
    // Project created before board columns feature — seed defaults
    await boardColumnRepository.seedDefaultColumns(projectId);
    columns = await boardColumnRepository.getColumnsByProjectId(projectId);
  } else if (!columns.some(c => c.isDefault) && columns[0]) {
    // Has columns but none is default — mark the first one
    await boardColumnRepository.setDefaultColumn(columns[0].id);
    columns = await boardColumnRepository.getColumnsByProjectId(projectId);
  }

  return columns;
};

export const createColumn = async (
  projectId: string,
  requesterId: string,
  data: { name: string; color?: string }
) => {
  await assertManager(projectId, requesterId);
  const name = data.name?.trim();
  if (!name) throw new ServiceError('Column name is required', 400);
  return boardColumnRepository.createColumn({
    projectId,
    name,
    ...(data.color !== undefined && { color: data.color }),
  });
};

export const updateColumn = async (
  projectId: string,
  columnId: string,
  requesterId: string,
  data: { name?: string; color?: string }
) => {
  await assertManager(projectId, requesterId);
  const column = await boardColumnRepository.getColumnById(columnId);
  if (!column || column.projectId !== projectId) throw new ServiceError('Column not found', 404);

  const updateData: { name?: string; color?: string } = {};
  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) throw new ServiceError('Column name cannot be empty', 400);
    updateData.name = name;
  }
  if (data.color !== undefined) updateData.color = data.color;

  return boardColumnRepository.updateColumn(columnId, updateData);
};

export const deleteColumn = async (
  projectId: string,
  columnId: string,
  requesterId: string
) => {
  await assertManager(projectId, requesterId);
  const column = await boardColumnRepository.getColumnById(columnId);
  if (!column || column.projectId !== projectId) throw new ServiceError('Column not found', 404);
  if (column.isDefault) throw new ServiceError('Cannot delete the default column', 400);

  const defaultColumn = await boardColumnRepository.getDefaultColumn(projectId);
  if (!defaultColumn) throw new ServiceError('No default column found. Cannot reassign tasks.', 500);

  await boardColumnRepository.deleteColumn(columnId, defaultColumn.id);
};

export const reorderColumns = async (
  projectId: string,
  requesterId: string,
  orderedIds: string[]
) => {
  await assertManager(projectId, requesterId);
  const columns = await boardColumnRepository.getColumnsByProjectId(projectId);
  const columnIds = new Set(columns.map((c) => c.id));
  for (const id of orderedIds) {
    if (!columnIds.has(id)) {
      throw new ServiceError(`Column ${id} does not belong to this project`, 400);
    }
  }
  const updates = orderedIds.map((id, index) => ({ id, order: index }));
  await boardColumnRepository.reorderColumns(updates);
};
