import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Universal access control function that checks if a user has access to a project
 * through either ownership or user role assignment
 */
export async function checkProjectAccess(userId: string, projectId: string): Promise<{
  hasAccess: boolean;
  role: string | null;
  userRoleId: string | null;
  isOwner: boolean;
}> {
  try {
    // First check if user owns the project
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        ownerId: true,
        userRoles: {
          where: { userId },
          select: {
            id: true,
            role: true,
            status: true
          }
        }
      }
    });

    if (!project) {
      return {
        hasAccess: false,
        role: null,
        userRoleId: null,
        isOwner: false
      };
    }

    // Check if user is the owner
    const isOwner = project.ownerId === userId;
    
    // Use union-based multi-role logic
    const rolesHeld = project.userRoles.map(r => r.role);
    const uniqueRoles = Array.from(new Set([...(isOwner ? ['PROJECT_OWNER'] : []), ...rolesHeld]));
    const primaryRole = uniqueRoles.includes('PROJECT_OWNER')
      ? 'PROJECT_OWNER'
      : (uniqueRoles.includes('PROJECT_MANAGER') ? 'PROJECT_MANAGER' : (uniqueRoles.includes('EMPLOYEE') ? 'EMPLOYEE' : null));

    // Check if user has any active roles
    const hasActiveRole = project.userRoles.some(role => role.status === 'ACTIVE');

    if (isOwner || hasActiveRole) {
      return {
        hasAccess: true,
        role: primaryRole,
        userRoleId: project.userRoles[0]?.id || null,
        isOwner: isOwner
      };
    }

    return {
      hasAccess: false,
      role: null,
      userRoleId: null,
      isOwner: false
    };
  } catch (error) {
    console.error('Error checking project access:', error);
    return {
      hasAccess: false,
      role: null,
      userRoleId: null,
      isOwner: false
    };
  }
}

/**
 * Check if user has specific role(s) in a project (including ownership)
 */
export async function checkProjectRole(
  userId: string, 
  projectId: string, 
  allowedRoles: string[]
): Promise<{
  hasRole: boolean;
  role: string | null;
  userRoleId: string | null;
  isOwner: boolean;
}> {
  const access = await checkProjectAccess(userId, projectId);
  
  if (!access.hasAccess) {
    return {
      hasRole: false,
      role: null,
      userRoleId: null,
      isOwner: false
    };
  }

  // PROJECT_OWNER has access to everything
  if (access.role === 'PROJECT_OWNER') {
    return {
      hasRole: true,
      role: 'PROJECT_OWNER',
      userRoleId: access.userRoleId,
      isOwner: true
    };
  }

  // Check if user has one of the allowed roles
  const hasRole = allowedRoles.includes(access.role || '');
  
  return {
    hasRole,
    role: access.role,
    userRoleId: access.userRoleId,
    isOwner: false
  };
}

/**
 * Get user's effective role in a project (ownership counts as PROJECT_OWNER)
 */
export async function getUserProjectRole(userId: string, projectId: string): Promise<{
  role: string | null;
  userRoleId: string | null;
  isOwner: boolean;
  hasAccess: boolean;
}> {
  const access = await checkProjectAccess(userId, projectId);
  
  return {
    role: access.role,
    userRoleId: access.userRoleId,
    isOwner: access.isOwner,
    hasAccess: access.hasAccess
  };
}
