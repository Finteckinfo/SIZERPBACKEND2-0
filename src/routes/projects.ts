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
  } = req.body;

  try {
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

      // Create departments
      const createdDepartments = [];
      if (departments && Array.isArray(departments)) {
        for (const dept of departments) {
          const department = await tx.department.create({
            data: {
              name: dept.name,
              type: dept.type,
              description: dept.description,
              order: dept.order || 0,
              projectId: project.id,
              managerId: dept.managerId,
            },
          });
          createdDepartments.push(department);
        }
      }

      // Create user roles
      const createdRoles = [];
      if (roles && Array.isArray(roles)) {
        for (const roleData of roles) {
          if (roleData.userId) {
            const userRole = await tx.userRole.create({
              data: {
                userId: roleData.userId,
                projectId: project.id,
                role: roleData.role,
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
