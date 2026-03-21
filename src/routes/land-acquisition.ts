import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { LandRequestStep, LandRequestStatus } from '@prisma/client';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * GET /api/land-acquisition/progress
 * Get current user's land acquisition progress (latest request)
 * Query params: search (filter by location/name), maxEscrow (filter by escrowAmount <= value)
 */
router.get('/progress', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const maxEscrow = typeof req.query.maxEscrow === 'string' ? parseFloat(req.query.maxEscrow) : NaN;

    const request = await prisma.landAcquisitionRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        selectedPlot: { include: { images: true, satelliteVerification: true } },
        plots: { include: { images: true, satelliteVerification: true } },
      },
    });

    if (!request) {
      return res.json({ request: null, currentStep: 'LOGIN' });
    }

    // Filter plots in DB layer: by search (name/fullAddress) and maxEscrow
    let plots = request.plots;
    if (search) {
      plots = plots.filter(
        (p) =>
          p.name.toLowerCase().includes(search) ||
          (p.fullAddress || '').toLowerCase().includes(search) ||
          (p.description || '').toLowerCase().includes(search)
      );
    }
    if (!isNaN(maxEscrow) && maxEscrow >= 0) {
      plots = plots.filter((p) => p.escrowAmount == null || p.escrowAmount <= maxEscrow);
    }

    return res.json({
      request: {
        id: request.id,
        walletAddress: request.walletAddress,
        budget: request.budget,
        sizeCurve: request.sizeCurve,
        purpose: request.purpose,
        plotReference: request.plotReference,
        currentStep: request.currentStep,
        status: request.status,
        selectedPlotId: request.selectedPlotId,
        escrowId: request.escrowId,
        escrowAmount: request.escrowAmount,
        escrowFundedAt: request.escrowFundedAt,
        selectedPlot: request.selectedPlot,
        plots,
        createdAt: request.createdAt,
      },
      currentStep: request.currentStep,
    });
  } catch (err) {
    console.error('[LandAcquisition] GET progress error:', err);
    return res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

/**
 * POST /api/land-acquisition/start
 * Start or resume workflow - creates draft request at CONNECT_WALLET step
 */
router.post('/start', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const existing = await prisma.landAcquisitionRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      return res.json({ request: existing, currentStep: existing.currentStep });
    }

    const request = await prisma.landAcquisitionRequest.create({
      data: {
        userId,
        currentStep: LandRequestStep.CONNECT_WALLET,
        status: LandRequestStatus.REQUEST_CREATED,
      },
    });

    return res.json({ request, currentStep: LandRequestStep.CONNECT_WALLET });
  } catch (err) {
    console.error('[LandAcquisition] POST start error:', err);
    return res.status(500).json({ error: 'Failed to start workflow' });
  }
});

/**
 * PATCH /api/land-acquisition/connect-wallet
 * Associate wallet with current request
 */
router.patch('/connect-wallet', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { walletAddress } = req.body;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!walletAddress || typeof walletAddress !== 'string') {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    let request = await prisma.landAcquisitionRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (!request) {
      request = await prisma.landAcquisitionRequest.create({
        data: {
          userId,
          walletAddress: walletAddress.trim(),
          currentStep: LandRequestStep.CONNECT_WALLET,
          status: LandRequestStatus.REQUEST_CREATED,
        },
      });
    } else {
      request = await prisma.landAcquisitionRequest.update({
        where: { id: request.id },
        data: { walletAddress: walletAddress.trim() },
      });
    }

    // Also update User wallet for consistency
    await prisma.user.update({
      where: { id: userId },
      data: { walletAddress: walletAddress.trim() },
    });

    return res.json({
      success: true,
      request,
      currentStep: LandRequestStep.CONNECT_WALLET,
    });
  } catch (err) {
    console.error('[LandAcquisition] PATCH connect-wallet error:', err);
    return res.status(500).json({ error: 'Failed to connect wallet' });
  }
});

/**
 * POST /api/land-acquisition/create-request
 * Submit Create Request form (budget, size, purpose)
 */
router.post('/create-request', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { walletAddress, budget, sizeCurve, purpose, plotReference } = req.body;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (budget == null || !sizeCurve || !purpose) {
      return res.status(400).json({
        error: 'budget, sizeCurve, and purpose are required',
      });
    }

    const budgetNum = typeof budget === 'string' ? parseFloat(budget) : Number(budget);
    if (isNaN(budgetNum) || budgetNum < 0) {
      return res.status(400).json({ error: 'Invalid budget' });
    }

    let request = await prisma.landAcquisitionRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (!request) {
      request = await prisma.landAcquisitionRequest.create({
        data: {
          userId,
          walletAddress: walletAddress?.trim() || null,
          budget: budgetNum,
          sizeCurve: String(sizeCurve).trim(),
          purpose: String(purpose).trim(),
          plotReference: plotReference ? String(plotReference).trim() : null,
          currentStep: LandRequestStep.CONFIRMATION,
          status: LandRequestStatus.REQUEST_CREATED,
        },
      });
    } else {
      request = await prisma.landAcquisitionRequest.update({
        where: { id: request.id },
        data: {
          walletAddress: walletAddress?.trim() || request.walletAddress,
          budget: budgetNum,
          sizeCurve: String(sizeCurve).trim(),
          purpose: String(purpose).trim(),
          plotReference: plotReference ? String(plotReference).trim() : null,
          currentStep: LandRequestStep.CONFIRMATION,
          status: LandRequestStatus.REQUEST_CREATED,
        },
      });
    }

    return res.json({
      success: true,
      request,
      currentStep: LandRequestStep.CONFIRMATION,
    });
  } catch (err) {
    console.error('[LandAcquisition] POST create-request error:', err);
    return res.status(500).json({ error: 'Failed to create request' });
  }
});

/**
 * PATCH /api/land-acquisition/update-criteria
 * Update request criteria (budget, sizeCurve, purpose, plotReference) - for filtering lands
 */
router.patch('/update-criteria', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { budget, sizeCurve, purpose, plotReference } = req.body;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const request = await prisma.landAcquisitionRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    if (!request) return res.status(404).json({ error: 'No land request found' });

    const data: Record<string, unknown> = {};
    if (budget != null) {
      const n = typeof budget === 'string' ? parseFloat(budget) : Number(budget);
      if (!isNaN(n) && n >= 0) data.budget = n;
    }
    if (sizeCurve != null && String(sizeCurve).trim()) data.sizeCurve = String(sizeCurve).trim();
    if (purpose != null && String(purpose).trim()) data.purpose = String(purpose).trim();
    if (plotReference != null) data.plotReference = String(plotReference).trim() || null;

    const updated = await prisma.landAcquisitionRequest.update({
      where: { id: request.id },
      data,
    });
    return res.json({ success: true, request: updated });
  } catch (err) {
    console.error('[LandAcquisition] PATCH update-criteria error:', err);
    return res.status(500).json({ error: 'Failed to update criteria' });
  }
});

/**
 * GET /api/land-acquisition/request/:id
 * Get single request (own requests only)
 */
router.get('/request/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const request = await prisma.landAcquisitionRequest.findFirst({
      where: { id, userId },
      include: {
        selectedPlot: { include: { images: true, satelliteVerification: true } },
        plots: { include: { images: true, satelliteVerification: true } },
      },
    });

    if (!request) return res.status(404).json({ error: 'Request not found' });
    return res.json(request);
  } catch (err) {
    console.error('[LandAcquisition] GET request error:', err);
    return res.status(500).json({ error: 'Failed to fetch request' });
  }
});

/**
 * POST /api/land-acquisition/select-plot
 * User selects a plot from options
 */
router.post('/select-plot', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { requestId, plotId } = req.body;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!requestId || !plotId) {
      return res.status(400).json({ error: 'requestId and plotId are required' });
    }

    const request = await prisma.landAcquisitionRequest.findFirst({
      where: { id: requestId, userId },
      include: { plots: true },
    });
    if (!request) return res.status(404).json({ error: 'Request not found' });

    const plotBelongsToRequest = request.plots.some((p) => p.id === plotId);
    if (!plotBelongsToRequest) {
      return res.status(400).json({ error: 'Plot does not belong to this request' });
    }

    const updated = await prisma.landAcquisitionRequest.update({
      where: { id: requestId },
      data: {
        selectedPlotId: plotId,
        status: LandRequestStatus.PLOT_SELECTED,
      },
      include: { selectedPlot: { include: { images: true, satelliteVerification: true } } },
    });

    return res.json({ success: true, request: updated });
  } catch (err) {
    console.error('[LandAcquisition] POST select-plot error:', err);
    return res.status(500).json({ error: 'Failed to select plot' });
  }
});

/**
 * POST /api/land-acquisition/escrow
 * Record escrow creation / funding
 */
router.post('/escrow', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { requestId, escrowId, escrowAmount, funded } = req.body;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!requestId) return res.status(400).json({ error: 'requestId is required' });

    const request = await prisma.landAcquisitionRequest.findFirst({
      where: { id: requestId, userId },
    });
    if (!request) return res.status(404).json({ error: 'Request not found' });

    const updateData: Record<string, unknown> = {};
    if (escrowId != null) updateData.escrowId = String(escrowId);
    if (escrowAmount != null) updateData.escrowAmount = Number(escrowAmount);
    if (funded === true) {
      updateData.escrowFundedAt = new Date();
      updateData.status = LandRequestStatus.ESCROW_FUNDED;
    } else if (escrowId) {
      updateData.status = LandRequestStatus.ESCROW_CREATED;
    }

    const updated = await prisma.landAcquisitionRequest.update({
      where: { id: requestId },
      data: updateData,
    });

    return res.json({ success: true, request: updated });
  } catch (err) {
    console.error('[LandAcquisition] POST escrow error:', err);
    return res.status(500).json({ error: 'Failed to update escrow' });
  }
});

// Admin check: user.isLandAdmin OR email in ADMIN_EMAILS (bootstrap)
const requireLandAdmin = async (req: Request, res: Response, next: NextFunction) => {
  const email = req.user?.email;
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (adminEmails.length > 0 && adminEmails.includes(email.toLowerCase())) {
    return next();
  }

  const dbUser = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { isLandAdmin: true },
  });
  if (dbUser?.isLandAdmin) return next();

  return res.status(403).json({ error: 'Land admin access required' });
};

router.use('/admin', requireLandAdmin);

/**
 * GET /api/land-acquisition/admin/requests
 * List all requests (admin)
 */
router.get('/admin/requests', async (_req: Request, res: Response) => {
  try {
    const requests = await prisma.landAcquisitionRequest.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        plots: { include: { images: true, satelliteVerification: true } },
        selectedPlot: { include: { images: true, satelliteVerification: true } },
      },
    });
    return res.json(requests);
  } catch (err) {
    console.error('[LandAcquisition] Admin GET requests error:', err);
    return res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

/**
 * POST /api/land-acquisition/admin/plots
 * Upload plot(s) for a request
 */
router.post('/admin/plots', async (req: Request, res: Response) => {
  try {
    const { requestId, name, fullAddress, description, escrowAmount, images, latitude, longitude, boundaryGeoJSON } = req.body;
    if (!requestId || !name || !fullAddress) {
      return res.status(400).json({ error: 'requestId, name, and fullAddress are required' });
    }

    // Validate lat/lng if provided (CASSINI geospatial)
    let latNum: number | null = null;
    let lngNum: number | null = null;
    if (latitude != null) {
      latNum = Number(latitude);
      if (isNaN(latNum) || latNum < -90 || latNum > 90) {
        return res.status(400).json({ error: 'latitude must be between -90 and 90' });
      }
    }
    if (longitude != null) {
      lngNum = Number(longitude);
      if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
        return res.status(400).json({ error: 'longitude must be between -180 and 180' });
      }
    }

    const plot = await prisma.landPlot.create({
      data: {
        requestId,
        name: String(name).trim(),
        fullAddress: String(fullAddress).trim(),
        description: description ? String(description).trim() : null,
        escrowAmount: escrowAmount != null ? Number(escrowAmount) : null,
        latitude: latNum,
        longitude: lngNum,
        boundaryGeoJSON: boundaryGeoJSON ?? undefined,
        images: images?.length
          ? {
              create: images.map((img: { url: string; order?: number }, i: number) => ({
                url: String(img.url),
                order: img.order ?? i,
              })),
            }
          : undefined,
      },
      include: { images: true, satelliteVerification: true },
    });

    await prisma.landAcquisitionRequest.update({
      where: { id: requestId },
      data: { status: LandRequestStatus.PLOT_FOUND },
    });

    return res.json({ success: true, plot });
  } catch (err) {
    console.error('[LandAcquisition] Admin POST plots error:', err);
    return res.status(500).json({ error: 'Failed to create plot' });
  }
});

/**
 * PATCH /api/land-acquisition/admin/request/:id/status
 * Update request status (admin)
 */
router.patch('/admin/request/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status || !Object.values(LandRequestStatus).includes(status)) {
      return res.status(400).json({ error: 'Valid status is required' });
    }

    const request = await prisma.landAcquisitionRequest.update({
      where: { id },
      data: { status },
    });
    return res.json({ success: true, request });
  } catch (err) {
    console.error('[LandAcquisition] Admin PATCH status error:', err);
    return res.status(500).json({ error: 'Failed to update status' });
  }
});

/**
 * POST /api/land-acquisition/admin/documents
 * Upload document for a request
 */
router.post('/admin/documents', async (req: Request, res: Response) => {
  try {
    const { requestId, type, fileUrl, fileHash } = req.body;
    const uploadedBy = (req as any).user?.id;
    if (!requestId || !type || !fileUrl) {
      return res.status(400).json({ error: 'requestId, type, and fileUrl are required' });
    }

    const doc = await prisma.landAcquisitionDocument.create({
      data: {
        requestId,
        type: String(type),
        fileUrl: String(fileUrl),
        fileHash: fileHash ? String(fileHash) : null,
        uploadedBy: uploadedBy || null,
      },
    });
    return res.json({ success: true, document: doc });
  } catch (err) {
    console.error('[LandAcquisition] Admin POST documents error:', err);
    return res.status(500).json({ error: 'Failed to upload document' });
  }
});

export default router;
