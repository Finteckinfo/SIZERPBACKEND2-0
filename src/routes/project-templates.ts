// src/routes/project-templates.ts
import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';

const router = Router();

/**
 * GET /api/project-templates
 * Get all active project templates
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const templates = await prisma.projectTemplate.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { name: 'asc' },
    });

    res.json(templates);
  } catch (error) {
    console.error('[Project Templates API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

/**
 * GET /api/project-templates/:id
 * Get a specific project template structure
 */
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const template = await prisma.projectTemplate.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        structure: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    if (!template.isActive) {
      return res.status(400).json({ error: 'Template is not active' });
    }

    res.json({
      id: template.id,
      name: template.name,
      description: template.description,
      structure: template.structure,
    });
  } catch (error) {
    console.error('[Project Templates API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch template' });
  }
});

/**
 * POST /api/project-templates
 * Create a new project template (admin only)
 */
router.post('/', async (req: Request, res: Response) => {
  const { name, description, structure } = req.body;

  if (!name || !structure) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    const template = await prisma.projectTemplate.create({
      data: {
        name,
        description,
        structure,
        isActive: true,
      },
    });

    res.status(201).json({
      id: template.id,
      name: template.name,
      description: template.description,
      structure: template.structure,
      message: 'Template created successfully',
    });
  } catch (error) {
    console.error('[Project Templates API] Error:', error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

/**
 * PUT /api/project-templates/:id
 * Update a project template (admin only)
 */
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description, structure, isActive } = req.body;

  try {
    const template = await prisma.projectTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const updatedTemplate = await prisma.projectTemplate.update({
      where: { id },
      data: {
        name: name || template.name,
        description: description !== undefined ? description : template.description,
        structure: structure || template.structure,
        isActive: isActive !== undefined ? isActive : template.isActive,
        updatedAt: new Date(),
      },
    });

    res.json({
      id: updatedTemplate.id,
      name: updatedTemplate.name,
      description: updatedTemplate.description,
      structure: updatedTemplate.structure,
      isActive: updatedTemplate.isActive,
      message: 'Template updated successfully',
    });
  } catch (error) {
    console.error('[Project Templates API] Error:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

/**
 * DELETE /api/project-templates/:id
 * Soft delete a project template (admin only)
 */
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const template = await prisma.projectTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Soft delete by setting isActive to false
    await prisma.projectTemplate.update({
      where: { id },
      data: { isActive: false },
    });

    res.json({ 
      message: 'Template deleted successfully',
      templateId: id,
    });
  } catch (error) {
    console.error('[Project Templates API] Error:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

export default router;
