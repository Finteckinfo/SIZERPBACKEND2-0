// src/routes/projects.ts
import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';

const router = Router();

/**
 * GET /api/projects/validate-name?name=...
 * Check if project name is available
 */
router.get('/validate-name', async (req: Request, res: Response) => {
  const { name } = req.query;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid name parameter' });
  }

  try {
    const existingProject = await prisma.project.findUnique({
      where: { name },
      select: { id: true },
    });

    res.json({ 
      available: !existingProject,
      name: name as string,
    });
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to validate project name' });
  }
});

/**
 * POST /api/projects/precheck
 * Preflight check for project creation
 */
router.post('/precheck', async (req: Request, res: Response) => {
  const { 
    name, 
    startDate, 
    endDate, 
    walletAddress, 
    userId,
    departments,
    roles 
  } = req.body;

  try {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required fields
    if (!name) errors.push('Project name is required');
    if (!startDate) errors.push('Start date is required');
    if (!endDate) errors.push('End date is required');
    if (!walletAddress) errors.push('Wallet address is required');
    if (!userId) errors.push('User ID is required');

    // Check date validity
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      if (isNaN(start.getTime())) errors.push('Invalid start date');
      if (isNaN(end.getTime())) errors.push('Invalid end date');
      if (start >= end) errors.push('End date must be after start date');
      
      // Check if dates are in the future
      const now = new Date();
      if (start < now) warnings.push('Start date is in the past');
    }

    // Check wallet ownership
    if (walletAddress && userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { walletAddress: true },
      });
      
      if (!user?.walletAddress) {
        errors.push('User wallet not connected');
      } else if (user.walletAddress !== walletAddress) {
        errors.push('Wallet address does not match user wallet');
      }
    }

    // Check name availability
    if (name) {
      const existingProject = await prisma.project.findUnique({
        where: { name },
        select: { id: true },
      });
      
      if (existingProject) {
        errors.push('Project name already exists');
      }
    }

    // Check department constraints
    if (departments && Array.isArray(departments)) {
      if (departments.length === 0) {
        warnings.push('No departments specified');
      }
      
      const majorDepts = departments.filter((dept: any) => dept.type === 'MAJOR');
      if (majorDepts.length === 0) {
        warnings.push('No major departments specified');
      }
    }

    // Check role constraints
    if (roles && Array.isArray(roles)) {
      const owners = roles.filter((role: any) => role.role === 'PROJECT_OWNER');
      if (owners.length === 0) {
        errors.push('At least one PROJECT_OWNER role is required');
      }
    }

    const isValid = errors.length === 0;
    
    res.json({
      isValid,
      errors,
      warnings,
      summary: {
        hasErrors: errors.length > 0,
        hasWarnings: warnings.length > 0,
        errorCount: errors.length,
        warningCount: warnings.length,
      },
    });
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to perform precheck' });
  }
});

/**
 * POST /api/projects
 * Create a new project with all related data
 */
router.post('/', async (req: Request, res: Response) => {
  const {
    name,
    description,
    type,
    startDate,
    endDate,
    priority,
    budgetRange,
    tags,
    departments,
    roles,
    walletAddress,
    userId,
    idempotencyKey,
    // Optional advanced fields
    roleDepartmentOrder, // Record<userId or email, string[]> of department IDs in desired order
    roleDepartmentScope, // Record<userId or email, string[]> of department IDs scoped
    departmentVisibility, // Array<{ name, type, description?, order, isVisible? }>
  } = req.body;

  try {
    // Verify wallet ownership
    if (walletAddress && userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { walletAddress: true },
      });
      if (!user?.walletAddress || user.walletAddress !== walletAddress) {
        return res.status(400).json({ error: 'Wallet address does not match requester' });
      }
    }
    // Check idempotency
    if (idempotencyKey) {
      const existingProject = await prisma.project.findFirst({
        where: { name },
        select: { id: true },
      });
      
      if (existingProject) {
        return res.json({
          project: existingProject,
          message: 'Project already exists (idempotency)',
        });
      }
    }

    // Create project with all related data in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create the project
      const project = await tx.project.create({
        data: {
          name,
          description,
          type,
          priority: priority || 'MEDIUM',
          budgetRange,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          ownerId: userId,
        },
      });

      // Create tags
      if (tags && Array.isArray(tags)) {
        await Promise.all(
          tags.map((tagName: string) =>
            tx.projectTag.create({
              data: {
                name: tagName,
                projectId: project.id,
              },
            })
          )
        );
      }

      // Create departments (support isVisible)
      const createdDepartments = [];
      const departmentsInput = Array.isArray(departmentVisibility) && departmentVisibility.length > 0
        ? departmentVisibility
        : departments;
      if (departmentsInput && Array.isArray(departmentsInput)) {
        for (const dept of departmentsInput) {
          const department = await tx.department.create({
            data: {
              name: dept.name,
              type: dept.type,
              description: dept.description,
              order: dept.order || 0,
              isVisible: typeof dept.isVisible === 'boolean' ? dept.isVisible : true,
              projectId: project.id,
              managerId: dept.managerId,
            },
          });
          createdDepartments.push(department);
        }
      }

      // Ensure at least one PROJECT_OWNER (fallback to creator)
      const hasOwner = Array.isArray(roles) && roles.some((r: any) => r.role === 'PROJECT_OWNER');
      const rolesWithFallback = [...(roles || [])];
      if (!hasOwner && userId) {
        rolesWithFallback.push({ userId, role: 'PROJECT_OWNER' });
      }

      // Create user roles with departmentOrder/departmentScope validation
      const createdRoles = [];
      if (rolesWithFallback && Array.isArray(rolesWithFallback)) {
        const deptIdSet = new Set((createdDepartments as any[]).map(d => d.id));
        for (const roleData of rolesWithFallback) {
          if (roleData.userId) {
            // resolve scoping/ordering by userId or email key
            const key = roleData.userId || roleData.userEmail;
            const orderFromBody: string[] | undefined = roleDepartmentOrder?.[key];
            const scopeFromBody: string[] | undefined = roleDepartmentScope?.[key];

            // Validate department ids provided exist in created departments
            const validOrder = Array.isArray(orderFromBody)
              ? orderFromBody.filter((id: string) => deptIdSet.has(id))
              : [];
            const validScope = Array.isArray(scopeFromBody)
              ? scopeFromBody.filter((id: string) => deptIdSet.has(id))
              : [];

            const userRole = await tx.userRole.create({
              data: {
                userId: roleData.userId,
                projectId: project.id,
                role: roleData.role,
                departmentOrder: validOrder,
                departmentScope: validScope,
              },
            });
            createdRoles.push(userRole);
          }
        }
      }

      // Create invites for users without IDs
      const createdInvites = [];
      if (roles && Array.isArray(roles)) {
        for (const roleData of roles) {
          if (roleData.userEmail && !roleData.userId) {
            const invite = await tx.projectInvite.create({
              data: {
                email: roleData.userEmail,
                role: roleData.role,
                projectId: project.id,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
              },
            });
            createdInvites.push(invite);
          }
        }
      }

      return {
        project,
        departments: createdDepartments,
        roles: createdRoles,
        invites: createdInvites,
      };
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

export default router;
