// src/routes/project-drafts.ts
import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';

const router = Router();

/**
 * POST /api/project-drafts
 * Create a new project draft
 * body: { data }
 */
router.post('/', async (req: Request, res: Response) => {
  const { data, userId } = req.body;

  if (!data || !userId) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    // Create a temporary project for the draft
    const tempProject = await prisma.project.create({
      data: {
        name: `Draft_${Date.now()}`,
        description: 'Temporary draft project',
        type: 'PROGRESSIVE',
        priority: 'MEDIUM',
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        ownerId: userId,
      },
    });

    // Create the draft
    const draft = await prisma.projectDraft.create({
      data: {
        projectId: tempProject.id,
        data: data,
      },
    });

    res.status(201).json({ 
      draftId: draft.id,
      projectId: tempProject.id,
      message: 'Draft created successfully',
    });
  } catch (error) {
    console.error('[Project Drafts API] Error:', error);
    res.status(500).json({ error: 'Failed to create draft' });
  }
});

/**
 * PUT /api/project-drafts/:draftId
 * Update a project draft (partial updates)
 * body: { data }
 */
router.put('/:draftId', async (req: Request, res: Response) => {
  const { draftId } = req.params;
  const { data } = req.body;

  if (!data) {
    return res.status(400).json({ error: 'Missing data parameter' });
  }

  try {
    const draft = await prisma.projectDraft.findUnique({
      where: { id: draftId },
      include: { project: true },
    });

    if (!draft) {
      return res.status(404).json({ error: 'Draft not found' });
    }

    // Merge existing data with new data
    const existingData = draft.data as Record<string, any>;
    const newData = data as Record<string, any>;
    const mergedData = { ...existingData, ...newData };

    const updatedDraft = await prisma.projectDraft.update({
      where: { id: draftId },
      data: { 
        data: mergedData,
        updatedAt: new Date(),
      },
    });

    res.json({ 
      draftId: updatedDraft.id,
      message: 'Draft updated successfully',
    });
  } catch (error) {
    console.error('[Project Drafts API] Error:', error);
    res.status(500).json({ error: 'Failed to update draft' });
  }
});

/**
 * GET /api/project-drafts/:draftId
 * Get a project draft
 */
router.get('/:draftId', async (req: Request, res: Response) => {
  const { draftId } = req.params;

  try {
    const draft = await prisma.projectDraft.findUnique({
      where: { id: draftId },
      include: { project: true },
    });

    if (!draft) {
      return res.status(404).json({ error: 'Draft not found' });
    }

    res.json({ 
      draftId: draft.id,
      projectId: draft.projectId,
      data: draft.data,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      project: draft.project,
    });
  } catch (error) {
    console.error('[Project Drafts API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch draft' });
  }
});

/**
 * DELETE /api/project-drafts/:draftId
 * Delete a project draft
 */
router.delete('/:draftId', async (req: Request, res: Response) => {
  const { draftId } = req.params;

  try {
    const draft = await prisma.projectDraft.findUnique({
      where: { id: draftId },
      include: { project: true },
    });

    if (!draft) {
      return res.status(404).json({ error: 'Draft not found' });
    }

    // Delete the draft and the temporary project
    await prisma.$transaction(async (tx) => {
      await tx.projectDraft.delete({
        where: { id: draftId },
      });
      
      await tx.project.delete({
        where: { id: draft.projectId },
      });
    });

    res.json({ 
      message: 'Draft deleted successfully',
      draftId: draftId,
    });
  } catch (error) {
    console.error('[Project Drafts API] Error:', error);
    res.status(500).json({ error: 'Failed to delete draft' });
  }
});

export default router;
