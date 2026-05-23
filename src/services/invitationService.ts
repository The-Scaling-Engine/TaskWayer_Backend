import crypto from 'crypto';
import { DepartmentInvitation, DepartmentMember, DepartmentMemberRole } from '@prisma/client';
import prisma from '../config/prisma';
import { PrismaInvitationRepository } from '../repositories/prisma/invitationRepository';
import { PrismaMembershipRepository } from '../repositories/prisma/membershipRepository';
import { PrismaDepartmentRepository } from '../repositories/prisma/departmentRepository';
import { PrismaProfileRepository } from '../repositories/prisma/profileRepository';
import { PrismaActivityLogRepository } from '../repositories/prisma/activityLogRepository';
import { InvitationWithInviter, PaginatedInvitationsResult } from '../repositories/interfaces';
import { ServiceError } from './departmentService';
import { mapPrismaConflict } from '../utils/prismaError';
import sendEmail from '../utils/email';
import * as notificationService from './notificationService';
import logger from '../config/logger';

const EXPIRY_DAYS = 7;

const invitationRepo = new PrismaInvitationRepository();
const membershipRepo = new PrismaMembershipRepository();
const departmentRepo = new PrismaDepartmentRepository();
const profileRepo = new PrismaProfileRepository();
const activityLogRepo = new PrismaActivityLogRepository();

// ─── Send Invitation ──────────────────────────────────────────

export const inviteMember = async (
  actorId: string,
  departmentId: string,
  email: string,
  role: DepartmentMemberRole = 'MEMBER'
): Promise<DepartmentInvitation> => {
  const dept = await departmentRepo.findById(departmentId);
  if (!dept) throw new ServiceError('Department not found', 404);

  if (role === 'OWNER') {
    throw new ServiceError('Cannot invite with OWNER role. Use transfer ownership.', 400);
  }

  const actorProfile = await profileRepo.findById(actorId);
  const isGlobalAdmin = actorProfile?.role === 'ADMIN';

  if (!isGlobalAdmin) {
    const actorMembership = await membershipRepo.findByUserAndDepartment(actorId, departmentId);
    if (!actorMembership || actorMembership.status !== 'ACTIVE') {
      throw new ServiceError('You are not a member of this department', 403);
    }
    if (!['OWNER', 'ADMIN'].includes(actorMembership.role)) {
      throw new ServiceError('Only OWNER or ADMIN can send invitations', 403);
    }
    if (actorMembership.role === 'ADMIN' && role === 'ADMIN') {
      throw new ServiceError('ADMIN cannot invite another ADMIN', 403);
    }
  }

  // Prevent inviting existing active member
  const existingProfile = await profileRepo.findByEmail(email);
  if (existingProfile) {
    const existingMembership = await membershipRepo.findByUserAndDepartment(
      existingProfile.id,
      departmentId
    );
    if (existingMembership && existingMembership.status === 'ACTIVE') {
      throw new ServiceError('This user is already an active member of this department', 409);
    }
  }

  // Prevent duplicate active invitations
  const existingInvite = await invitationRepo.findActiveByDepartmentAndEmail(departmentId, email);
  if (existingInvite) {
    throw new ServiceError(
      'An active invitation already exists for this email in this department',
      409
    );
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const invitation = await invitationRepo.create({
    departmentId,
    email,
    role,
    token,
    invitedBy: actorId,
    expiresAt,
  });

  const acceptUrl = `${process.env.CLIENT_URL}/invitations/accept?token=${token}`;
  try {
    await sendEmail({
      email,
      subject: `You've been invited to join "${dept.name}" on TasksWayer`,
      message:
        `You have been invited to join the department "${dept.name}" as ${role}.\n\n` +
        `Accept your invitation here (valid for ${EXPIRY_DAYS} days):\n\n${acceptUrl}\n\n` +
        `If you did not expect this invitation, you can safely ignore this email.`,
      html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#ffffff;border-radius:12px">
  <h2 style="color:#1A1A1A;margin-top:0">You've been invited!</h2>
  <p style="color:#4B5563;font-size:15px;line-height:1.6">
    You have been invited to join the department
    <strong style="color:#1A1A1A">&quot;${dept.name}&quot;</strong>
    as <strong style="color:#1A1A1A">${role}</strong>.
  </p>
  <p style="color:#4B5563;font-size:15px">This invitation is valid for ${EXPIRY_DAYS} days.</p>
  <div style="text-align:center;margin:36px 0">
    <a href="${acceptUrl}"
       style="display:inline-block;padding:14px 36px;background-color:#10BA41;color:#ffffff;
              text-decoration:none;border-radius:8px;font-weight:700;font-size:16px;
              letter-spacing:0.3px">
      Open Invitation
    </a>
  </div>
  <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0" />
  <p style="color:#9CA3AF;font-size:13px;margin:0">
    If you did not expect this invitation, you can safely ignore this email.
  </p>
</div>`,
    });
  } catch {
    await invitationRepo.delete(invitation.id);
    throw new ServiceError('Failed to send invitation email. Please try again.', 500);
  }

  void activityLogRepo.create({
    actorUserId: actorId,
    departmentId,
    entityType: 'invitation',
    entityId: invitation.id,
    action: 'invitation.sent',
    metadata: { email, role },
  });

  return invitation;
};

// ─── Accept Invitation ────────────────────────────────────────

export const acceptInvitation = async (
  token: string,
  userId: string
): Promise<DepartmentMember> => {
  const invitation = await invitationRepo.findByToken(token);
  if (!invitation) throw new ServiceError('Invitation not found or invalid token', 404);

  if (invitation.acceptedAt) {
    throw new ServiceError('This invitation has already been accepted', 409);
  }
  if (invitation.expiresAt < new Date()) {
    throw new ServiceError('This invitation has expired', 410);
  }

  const profile = await profileRepo.findById(userId);
  if (!profile) throw new ServiceError('User not found', 404);

  if (profile.email.toLowerCase() !== invitation.email.toLowerCase()) {
    throw new ServiceError('This invitation was sent to a different email address', 403);
  }

  const existingMembership = await membershipRepo.findByUserAndDepartment(
    userId,
    invitation.departmentId
  );
  if (existingMembership && existingMembership.status === 'ACTIVE') {
    throw new ServiceError('You are already an active member of this department', 409);
  }

  const membership = await prisma.$transaction(async (tx) => {
    const inv = await tx.departmentInvitation.findUnique({ where: { id: invitation.id } });
    if (!inv || inv.acceptedAt !== null) {
      throw new ServiceError('This invitation has already been accepted', 409);
    }

    let mem: DepartmentMember;
    if (existingMembership) {
      mem = await tx.departmentMember.update({
        where: { id: existingMembership.id },
        data: { role: invitation.role, status: 'ACTIVE' },
      });
    } else {
      mem = await tx.departmentMember.create({
        data: {
          userId,
          departmentId: invitation.departmentId,
          role: invitation.role,
          invitedBy: invitation.invitedBy,
        },
      });
    }

    await tx.departmentInvitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    });

    return mem;
  }).catch((err: unknown) => mapPrismaConflict(err, 'This invitation has already been accepted'));

  void activityLogRepo.create({
    actorUserId: userId,
    departmentId: invitation.departmentId,
    entityType: 'invitation',
    entityId: invitation.id,
    action: 'invitation.accepted',
    metadata: { email: invitation.email, role: invitation.role },
  });

  const dept = await departmentRepo.findById(invitation.departmentId);
  if (dept) {
    void notificationService.createNotification({
      userId:     userId,
      type:       'DEPT_MEMBER_JOINED',
      title:      'You have joined a department',
      message:    `You have successfully joined "${dept.name}" as ${invitation.role}.`,
      payload:    { departmentId: invitation.departmentId, role: invitation.role },
      entityType: 'department',
      entityId:   invitation.departmentId,
    }).catch(err => logger.error({ err, context: 'invitation.accepted notification' }, 'Fire-and-forget failed'));
  }

  return membership;
};

// ─── Reject Invitation ────────────────────────────────────────

export const rejectInvitation = async (token: string, userId: string): Promise<void> => {
  const invitation = await invitationRepo.findByToken(token);
  if (!invitation) throw new ServiceError('Invitation not found or invalid token', 404);

  if (invitation.acceptedAt) {
    throw new ServiceError('This invitation has already been accepted', 409);
  }

  const profile = await profileRepo.findById(userId);
  if (!profile) throw new ServiceError('User not found', 404);

  if (profile.email.toLowerCase() !== invitation.email.toLowerCase()) {
    throw new ServiceError('This invitation was sent to a different email address', 403);
  }

  await invitationRepo.delete(invitation.id);
};

// ─── Cancel Invitation (by OWNER/ADMIN) ──────────────────────

export const cancelInvitation = async (
  actorId: string,
  departmentId: string,
  invitationId: string
): Promise<void> => {
  const actorProfile = await profileRepo.findById(actorId);
  if (!actorProfile?.role || actorProfile.role !== 'ADMIN') {
    const actorMembership = await membershipRepo.findByUserAndDepartment(actorId, departmentId);
    if (!actorMembership || actorMembership.status !== 'ACTIVE') {
      throw new ServiceError('You are not a member of this department', 403);
    }
    if (!['OWNER', 'ADMIN'].includes(actorMembership.role)) {
      throw new ServiceError('Only OWNER or ADMIN can cancel invitations', 403);
    }
  }

  const invitation = await invitationRepo.findById(invitationId);
  if (!invitation || invitation.departmentId !== departmentId) {
    throw new ServiceError('Invitation not found', 404);
  }
  if (invitation.acceptedAt) {
    throw new ServiceError('Cannot cancel an already accepted invitation', 409);
  }

  await invitationRepo.delete(invitationId);
};

// ─── List Pending Invitations ─────────────────────────────────

export const listPendingInvitations = async (
  departmentId: string,
  page: number,
  limit: number
): Promise<PaginatedInvitationsResult> => {
  const dept = await departmentRepo.findById(departmentId);
  if (!dept) throw new ServiceError('Department not found', 404);
  return invitationRepo.findPendingByDepartment(departmentId, page, limit);
};
