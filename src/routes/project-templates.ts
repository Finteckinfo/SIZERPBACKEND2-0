// src/routes/project-templates.ts
import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';

const router = Router();

/**
 * GET /api/project-templates
 * Get available project templates
 */
router.get('/', async (req: Request, res: Response) => {
  const {
    page = 1,
    limit = 20,
    search,
    isActive,
    sortBy = 'name',
    sortOrder = 'asc'
  } = req.query;

  try {
    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 20, 100);
    const offset = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    // Build orderBy clause
    const orderBy: any = {};
    orderBy[sortBy as string] = sortOrder;

    // Get project templates
    const [templates, totalCount] = await Promise.all([
      prisma.projectTemplate.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          isActive: true,
          createdAt: true,
          updatedAt: true
        },
        skip: offset,
        take: limitNum,
        orderBy
      }),
      prisma.projectTemplate.count({ where })
    ]);

    res.json({
      templates,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
        hasNext: pageNum * limitNum < totalCount,
        hasPrev: pageNum > 1
      }
    });
  } catch (error) {
    console.error('[Project Templates API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch project templates' });
  }
});

/**
 * GET /api/project-templates/:templateId
 * Get template structure
 */
router.get('/:templateId', async (req: Request, res: Response) => {
  const { templateId } = req.params;

  try {
    const template = await prisma.projectTemplate.findUnique({
      where: { id: templateId },
      select: {
        id: true,
        name: true,
        description: true,
        structure: true,
        isActive: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!template) {
      return res.status(404).json({ error: 'Project template not found' });
    }

    if (!template.isActive) {
      return res.status(400).json({ error: 'Project template is not active' });
    }

    res.json(template);
  } catch (error) {
    console.error('[Project Templates API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch template structure' });
  }
});

/**
 * POST /api/project-templates
 * Create new project template
 */
router.post('/', async (req: Request, res: Response) => {
  const { name, description, structure, isActive = true } = req.body;

  try {
    // Validate required fields
    if (!name || !structure) {
      return res.status(400).json({ error: 'Name and structure are required' });
    }

    // Check if template name already exists
    const existingTemplate = await prisma.projectTemplate.findFirst({
      where: { name }
    });

    if (existingTemplate) {
      return res.status(400).json({ error: 'Project template with this name already exists' });
    }

    // Validate structure is valid JSON
    if (typeof structure !== 'object' || structure === null) {
      return res.status(400).json({ error: 'Structure must be a valid JSON object' });
    }

    const template = await prisma.projectTemplate.create({
      data: {
        name,
        description,
        structure,
        isActive
      }
    });

    res.status(201).json({
      message: 'Project template created successfully',
      template
    });
  } catch (error) {
    console.error('[Project Templates API] Error:', error);
    res.status(500).json({ error: 'Failed to create project template' });
  }
});

/**
 * PATCH /api/project-templates/:templateId
 * Update project template
 */
router.patch('/:templateId', async (req: Request, res: Response) => {
  const { templateId } = req.params;
  const { name, description, structure, isActive } = req.body;

  try {
    // Check if template exists
    const existingTemplate = await prisma.projectTemplate.findUnique({
      where: { id: templateId }
    });

    if (!existingTemplate) {
      return res.status(404).json({ error: 'Project template not found' });
    }

    // Check name uniqueness if name is being updated
    if (name && name !== existingTemplate.name) {
      const nameConflict = await prisma.projectTemplate.findFirst({
        where: {
          name,
          id: { not: templateId }
        }
      });

      if (nameConflict) {
        return res.status(400).json({ error: 'Project template with this name already exists' });
      }
    }

    // Validate structure if provided
    if (structure !== undefined) {
      if (typeof structure !== 'object' || structure === null) {
        return res.status(400).json({ error: 'Structure must be a valid JSON object' });
      }
    }

    const updatedTemplate = await prisma.projectTemplate.update({
      where: { id: templateId },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(structure !== undefined && { structure }),
        ...(isActive !== undefined && { isActive })
      }
    });

    res.json({
      message: 'Project template updated successfully',
      template: updatedTemplate
    });
  } catch (error) {
    console.error('[Project Templates API] Error:', error);
    res.status(500).json({ error: 'Failed to update project template' });
  }
});

/**
 * DELETE /api/project-templates/:templateId
 * Delete project template
 */
router.delete('/:templateId', async (req: Request, res: Response) => {
  const { templateId } = req.params;

  try {
    // Check if template exists
    const existingTemplate = await prisma.projectTemplate.findUnique({
      where: { id: templateId }
    });

    if (!existingTemplate) {
      return res.status(404).json({ error: 'Project template not found' });
    }

    await prisma.projectTemplate.delete({
      where: { id: templateId }
    });

    res.json({ message: 'Project template deleted successfully' });
  } catch (error) {
    console.error('[Project Templates API] Error:', error);
    res.status(500).json({ error: 'Failed to delete project template' });
  }
});

/**
 * POST /api/project-templates/:templateId/duplicate
 * Duplicate project template
 */
router.post('/:templateId/duplicate', async (req: Request, res: Response) => {
  const { templateId } = req.params;
  const { name, description } = req.body;

  try {
    // Check if template exists
    const existingTemplate = await prisma.projectTemplate.findUnique({
      where: { id: templateId }
    });

    if (!existingTemplate) {
      return res.status(404).json({ error: 'Project template not found' });
    }

    // Generate new name if not provided
    let newName = name;
    if (!newName) {
      let counter = 1;
      do {
        newName = `${existingTemplate.name} (Copy ${counter})`;
        counter++;
      } while (await prisma.projectTemplate.findFirst({ where: { name: newName } }));
    }

    // Check if new name already exists
    const nameConflict = await prisma.projectTemplate.findFirst({
      where: { name: newName }
    });

    if (nameConflict) {
      return res.status(400).json({ error: 'Project template with this name already exists' });
    }

    const duplicatedTemplate = await prisma.projectTemplate.create({
      data: {
        name: newName,
        description: description || existingTemplate.description,
        structure: existingTemplate.structure as any,
        isActive: false // Start as inactive for review
      }
    });

    res.status(201).json({
      message: 'Project template duplicated successfully',
      template: duplicatedTemplate
    });
  } catch (error) {
    console.error('[Project Templates API] Error:', error);
    res.status(500).json({ error: 'Failed to duplicate project template' });
  }
});

/**
 * POST /api/project-templates/:templateId/activate
 * Activate/deactivate project template
 */
router.post('/:templateId/activate', async (req: Request, res: Response) => {
  const { templateId } = req.params;
  const { isActive } = req.body;

  try {
    // Check if template exists
    const existingTemplate = await prisma.projectTemplate.findUnique({
      where: { id: templateId }
    });

    if (!existingTemplate) {
      return res.status(404).json({ error: 'Project template not found' });
    }

    const updatedTemplate = await prisma.projectTemplate.update({
      where: { id: templateId },
      data: { isActive }
    });

    res.json({
      message: `Project template ${isActive ? 'activated' : 'deactivated'} successfully`,
      template: updatedTemplate
    });
  } catch (error) {
    console.error('[Project Templates API] Error:', error);
    res.status(500).json({ error: 'Failed to update template status' });
  }
});

export default router;
