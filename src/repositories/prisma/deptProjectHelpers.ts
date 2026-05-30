import prisma from '../../config/prisma';

export async function getProjectIdsByDepartment(departmentId: string): Promise<string[]> {
  const links = await prisma.projectDepartment.findMany({
    where:  { departmentId },
    select: { projectId: true },
  });
  return links.map(l => l.projectId);
}

export async function getProjectIdsByDepartments(
  departmentIds: string[]
): Promise<Map<string, string[]>> {
  if (departmentIds.length === 0) return new Map();
  const links = await prisma.projectDepartment.findMany({
    where:  { departmentId: { in: departmentIds } },
    select: { projectId: true, departmentId: true },
  });
  const map = new Map<string, string[]>();
  for (const l of links) {
    const arr = map.get(l.departmentId) ?? [];
    arr.push(l.projectId);
    map.set(l.departmentId, arr);
  }
  return map;
}
