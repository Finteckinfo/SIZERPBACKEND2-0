// src/routes/departments.ts
import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';

const router = Router();

/**
 * POST /api/projects/:projectId/departments/bulk
 * Create multiple departments for a project
 */
router.post('/:projectId/bulk', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const { departments } = req.body;

  if (!departments || !Array.isArray(departments)) {
    return res.status(400).json({ error: 'Missing or invalid departments array' });
  }

  try {
    // Verify project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Create departments
    const createdDepartments = await Promise.all(
      departments.map(async (dept: any) => {
        return await prisma.department.create({
          data: {
            name: dept.name,
            type: dept.type,
            description: dept.description,
            order: dept.order || 0,
            projectId,
            managerId: dept.managerId,
          },
        });
      })
    );

    res.status(201).json({
      message: 'Departments created successfully',
      departments: createdDepartments,
    });
  } catch (error) {
    console.error('[Departments API] Error:', error);
    res.status(500).json({ error: 'Failed to create departments' });
  }
});

/**
 * PUT /api/projects/:projectId/departments/:departmentId
 * Update a department
 */
router.put('/:projectId/:departmentId', async (req: Request, res: Response) => {
  const { projectId, departmentId } = req.params;
  const { name, type, description, order } = req.body;

  try {
    // Verify department exists and belongs to project
    const department = await prisma.department.findFirst({
      where: {
        id: departmentId,
        projectId,
      },
    });

    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    // Update department
    const updatedDepartment = await prisma.department.update({
      where: { id: departmentId },
      data: {
        name: name || department.name,
        type: type || department.type,
        description: description !== undefined ? description : department.description,
        order: order !== undefined ? order : department.order,
        updatedAt: new Date(),
      },
    });

    res.json({
      message: 'Department updated successfully',
      department: updatedDepartment,
    });
  } catch (error) {
    console.error('[Departments API] Error:', error);
    res.status(500).json({ error: 'Failed to update department' });
  }
});

/**
 * DELETE /api/projects/:projectId/departments/:departmentId
 * Delete a department
 */
router.delete('/:projectId/:departmentId', async (req: Request, res: Response) => {
  const { projectId, departmentId } = req.params;

  try {
    // Verify department exists and belongs to project
    const department = await prisma.department.findFirst({
      where: {
        id: departmentId,
        projectId,
      },
      include: {
        tasks: {
          select: { id: true },
        },
      },
    });

    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    // Check if department has tasks
    if (department.tasks.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete department with existing tasks',
        taskCount: department.tasks.length,
      });
    }

    // Delete department
    await prisma.department.delete({
      where: { id: departmentId },
    });

    res.json({
      message: 'Department deleted successfully',
      departmentId,
    });
  } catch (error) {
    console.error('[Departments API] Error:', error);
    res.status(500).json({ error: 'Failed to delete department' });
  }
});

/**
 * POST /api/projects/:projectId/departments/reorder
 * Reorder departments
 */
router.post('/:projectId/reorder', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const { departments } = req.body;

  if (!departments || !Array.isArray(departments)) {
    return res.status(400).json({ error: 'Missing or invalid departments array' });
  }

  try {
    // Verify project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Update department orders in a transaction
    await prisma.$transaction(async (tx) => {
      for (const dept of departments) {
        await tx.department.update({
          where: {
            id: dept.departmentId,
            projectId, // Ensure department belongs to project
          },
          data: { order: dept.order },
        });
      }
    });

    res.json({
      message: 'Departments reordered successfully',
      departments,
    });
  } catch (error) {
    console.error('[Departments API] Error:', error);
    res.status(500).json({ error: 'Failed to reorder departments' });
  }
});

export default router;
