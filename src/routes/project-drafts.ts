// src/routes/project-drafts.ts
import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';

const router = Router();

/**
 * POST /api/project-drafts
 * Create or update a project draft for a user
 * body: { data, userId, projectId? }
 */
router.post('/', async (req: Request, res: Response) => {
  const { data, userId, projectId } = req.body;

  if (!data || !userId) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    let draft;
    let isNewDraft = false;

    // Check if user already has a draft for this project (if projectId provided)
    // or check for any existing draft by this user
    if (projectId) {
      // Look for existing draft for this specific project
      draft = await prisma.projectDraft.findFirst({
        where: { 
          projectId,
          project: { ownerId: userId }
        },
        include: { project: true },
      });
    } else {
      // Look for any existing draft by this user (most recent)
      draft = await prisma.projectDraft.findFirst({
        where: { 
          project: { ownerId: userId }
        },
        include: { project: true },
        orderBy: { updatedAt: 'desc' },
      });
    }

    if (draft) {
      // Update existing draft
      const existingData = draft.data as Record<string, any>;
      const newData = data as Record<string, any>;
      const mergedData = { ...existingData, ...newData };

      draft = await prisma.projectDraft.update({
        where: { id: draft.id },
        data: { 
          data: mergedData,
          updatedAt: new Date(),
        },
        include: { project: true },
      });

      res.json({ 
        draftId: draft.id,
        projectId: draft.projectId,
        message: 'Draft updated successfully',
        isNewDraft: false,
      });
    } else {
      // Create new draft with temporary project
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

      draft = await prisma.projectDraft.create({
        data: {
          projectId: tempProject.id,
          data: data,
        },
        include: { project: true },
      });

      isNewDraft = true;

      res.status(201).json({ 
        draftId: draft.id,
        projectId: tempProject.id,
        message: 'New draft created successfully',
        isNewDraft: true,
      });
    }
  } catch (error) {
    console.error('[Project Drafts API] Error:', error);
    res.status(500).json({ error: 'Failed to create/update draft' });
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
      message: 'Draft updated successfully',
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
 * GET /api/project-drafts/user/:userId
 * Get all drafts for a specific user
 */
router.get('/user/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;

  try {
    const drafts = await prisma.projectDraft.findMany({
      where: { 
        project: { ownerId: userId }
      },
      include: { project: true },
      orderBy: { updatedAt: 'desc' },
    });

    res.json(drafts);
  } catch (error) {
    console.error('[Project Drafts API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch user drafts' });
  }
});

/**
 * POST /api/project-drafts/:draftId/convert
 * Convert a draft to a real project and clean up draft data
 * body: { projectData } - the final project data to use
 */
router.post('/:draftId/convert', async (req: Request, res: Response) => {
  const { draftId } = req.params;
  const { projectData } = req.body;

  if (!projectData) {
    return res.status(400).json({ error: 'Missing project data' });
  }

  try {
    const draft = await prisma.projectDraft.findUnique({
      where: { id: draftId },
      include: { project: true },
    });

    if (!draft) {
      return res.status(404).json({ error: 'Draft not found' });
    }

    // Convert the temporary project to a real project
    const updatedProject = await prisma.project.update({
      where: { id: draft.projectId },
      data: {
        name: projectData.name,
        description: projectData.description,
        type: projectData.type,
        priority: projectData.priority,
        budgetRange: projectData.budgetRange,
        startDate: new Date(projectData.startDate),
        endDate: new Date(projectData.endDate),
      },
    });

    // Delete the draft (clean up)
    await prisma.projectDraft.delete({
      where: { id: draftId },
    });

    res.json({
      message: 'Draft converted to project successfully',
      project: updatedProject,
      draftId: draftId,
    });
  } catch (error) {
    console.error('[Project Drafts API] Error:', error);
    res.status(500).json({ error: 'Failed to convert draft' });
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
