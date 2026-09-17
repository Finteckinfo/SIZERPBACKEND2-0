import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { LandRequestStep, LandRequestStatus, LandListingStatus, ListingKind } from '@prisma/client';

const router = Router();

const listingPublicFields = {
  id: true,
  title: true,
  description: true,
  fullAddress: true,
  listPrice: true,
  currency: true,
  latitude: true,
  longitude: true,
  kind: true,
  region: true,
  badges: true,
  media: true,
  satelliteSceneDate: true,
  status: true,
  updatedAt: true,
} as const;

async function notify(userId: string, title: string, body: string, href?: string) {
  try {
    await prisma.landNotification.create({ data: { userId, title, body, href: href || null } });
  } catch (err) {
    console.warn('[LandAcquisition] notify failed', err);
  }
}

function parseKind(raw: unknown): ListingKind {
  return String(raw).toUpperCase() === 'COMMODITY' ? ListingKind.COMMODITY : ListingKind.LAND;
}

function parseListingStatus(raw: unknown): LandListingStatus | null {
  const s = String(raw || '').toUpperCase();
  return (Object.values(LandListingStatus) as string[]).includes(s) ? (s as LandListingStatus) : null;
}

function parseOptionalPrice(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'string' ? parseFloat(raw.replace(/[^0-9.-]/g, '')) : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const dealInclude = {
  listing: true,
  documents: true,
  selectedPlot: { include: { images: true, satelliteVerification: true } },
  plots: { include: { images: true, satelliteVerification: true } },
} as const;

async function notifyLandAdmins(title: string, body: string, href?: string) {
  const admins = await prisma.user.findMany({ where: { isLandAdmin: true }, select: { id: true } });
  await Promise.all(admins.map((a) => notify(a.id, title, body, href)));
}

/**
 * GET /api/land-acquisition/catalog/listings
 * Published inventory for public browse (no authentication).
 */
router.get('/catalog/listings', async (_req: Request, res: Response) => {
  try {
    const listings = await prisma.landListing.findMany({
      where: { status: LandListingStatus.PUBLISHED },
      orderBy: { updatedAt: 'desc' },
      select: listingPublicFields,
    });
    return res.json(listings);
  } catch (err) {
    console.error('[LandAcquisition] GET public catalog error:', err);
    return res.status(500).json({ error: 'Failed to load listings' });
  }
});

// All routes below require authentication
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
        documents: true,
        listing: true,
        selectedPlot: { include: { images: true, satelliteVerification: true } },
        plots: { include: { images: true, satelliteVerification: true } },
      },
    });

    if (!request) {
      return res.json({ request: null, currentStep: LandRequestStep.CREATE_REQUEST });
    }

    const currentStep =
      request.currentStep === LandRequestStep.CONFIRMATION
        ? LandRequestStep.CONFIRMATION
        : LandRequestStep.CREATE_REQUEST;

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
        contactName: request.contactName,
        contactEmail: request.contactEmail,
        budget: request.budget,
        sizeCurve: request.sizeCurve,
        purpose: request.purpose,
        plotReference: request.plotReference,
        listingId: request.listingId,
        listing: request.listing,
        currentStep,
        status: request.status,
        selectedPlotId: request.selectedPlotId,
        escrowId: request.escrowId,
        escrowAmount: request.escrowAmount,
        escrowFundedAt: request.escrowFundedAt,
        documents: request.documents,
        selectedPlot: request.selectedPlot,
        plots,
        createdAt: request.createdAt,
      },
      currentStep,
    });
  } catch (err) {
    console.error('[LandAcquisition] GET progress error:', err);
    return res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

/**
 * POST /api/land-acquisition/start
 * Start or resume workflow — SizWallet login already happened; intake starts at Create Request.
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
      const currentStep =
        existing.currentStep === LandRequestStep.CONFIRMATION
          ? LandRequestStep.CONFIRMATION
          : LandRequestStep.CREATE_REQUEST;
      return res.json({ request: existing, currentStep });
    }

    const request = await prisma.landAcquisitionRequest.create({
      data: {
        userId,
        currentStep: LandRequestStep.CREATE_REQUEST,
        status: LandRequestStatus.REQUEST_CREATED,
      },
    });

    return res.json({ request, currentStep: LandRequestStep.CREATE_REQUEST });
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
          currentStep: LandRequestStep.CREATE_REQUEST,
          status: LandRequestStatus.REQUEST_CREATED,
        },
      });
    } else {
      request = await prisma.landAcquisitionRequest.update({
        where: { id: request.id },
        data: {
          walletAddress: walletAddress.trim(),
          currentStep:
            request.currentStep === LandRequestStep.CONFIRMATION
              ? LandRequestStep.CONFIRMATION
              : LandRequestStep.CREATE_REQUEST,
        },
      });
    }

    // Also update User wallet for consistency (non-fatal if user missing)
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { walletAddress: walletAddress.trim() },
      });
    } catch (userErr: any) {
      console.warn('[LandAcquisition] Could not sync wallet to User (non-fatal):', userErr?.code, userErr?.message);
    }

    return res.json({
      success: true,
      request,
      currentStep:
        request.currentStep === LandRequestStep.CONFIRMATION
          ? LandRequestStep.CONFIRMATION
          : LandRequestStep.CREATE_REQUEST,
    });
  } catch (err: any) {
    console.error('[LandAcquisition] PATCH connect-wallet error:', err?.message || err, err?.code);
    return res.status(500).json({
      error: 'Failed to connect wallet',
      ...(process.env.NODE_ENV === 'development' && { details: err?.message }),
    });
  }
});

/**
 * POST /api/land-acquisition/create-request
 * Submit Create Request form (purpose + contact). Budget/size are optional — users filter later when browsing.
 */
router.post('/create-request', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const {
      walletAddress,
      budget,
      sizeCurve,
      purpose,
      plotReference,
      contactName,
      contactEmail,
      name,
      email,
    } = req.body;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!purpose) {
      return res.status(400).json({
        error: 'purpose is required',
      });
    }

    const resolvedName = String(contactName || name || '').trim();
    const resolvedEmail = String(contactEmail || email || '').trim().toLowerCase();
    if (!resolvedName) {
      return res.status(400).json({ error: 'Name is required for communication' });
    }
    if (!resolvedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resolvedEmail)) {
      return res.status(400).json({ error: 'A valid email is required for follow-up' });
    }

    let budgetNum: number | null = null;
    if (budget != null && budget !== '') {
      budgetNum = typeof budget === 'string' ? parseFloat(budget) : Number(budget);
      if (isNaN(budgetNum) || budgetNum < 0) {
        return res.status(400).json({ error: 'Invalid budget' });
      }
    }

    const resolvedSize =
      sizeCurve != null && String(sizeCurve).trim() ? String(sizeCurve).trim() : null;

    let request = await prisma.landAcquisitionRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const contactData = {
      contactName: resolvedName,
      contactEmail: resolvedEmail,
    };

    if (!request) {
      request = await prisma.landAcquisitionRequest.create({
        data: {
          userId,
          walletAddress: walletAddress?.trim() || null,
          ...contactData,
          budget: budgetNum,
          sizeCurve: resolvedSize,
          purpose: String(purpose).trim(),
          plotReference: plotReference ? String(plotReference).trim() : null,
          currentStep: LandRequestStep.CREATE_REQUEST,
          status: LandRequestStatus.REQUEST_CREATED,
        },
      });
    } else if (request.listingId) {
      // Profile / contact update must not reset an in-flight deal.
      request = await prisma.landAcquisitionRequest.update({
        where: { id: request.id },
        data: {
          walletAddress: walletAddress?.trim() || request.walletAddress,
          ...contactData,
          purpose: String(purpose).trim(),
        },
      });
    } else {
      request = await prisma.landAcquisitionRequest.update({
        where: { id: request.id },
        data: {
          walletAddress: walletAddress?.trim() || request.walletAddress,
          ...contactData,
          budget: budgetNum,
          sizeCurve: resolvedSize ?? request.sizeCurve,
          purpose: String(purpose).trim(),
          plotReference: plotReference ? String(plotReference).trim() : null,
          currentStep: LandRequestStep.CREATE_REQUEST,
          status: LandRequestStatus.REQUEST_CREATED,
        },
      });
    }

    // Ops signal: contactEmail is indexed for manual <48h sourcing follow-up
    console.info('[LandAcquisition] intake details saved', {
      requestId: request.id,
      contactEmail: resolvedEmail,
      contactName: resolvedName,
    });

    return res.json({
      success: true,
      request,
      currentStep: LandRequestStep.CREATE_REQUEST,
      sourcingFollowUp: false,
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
      include: dealInclude,
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

/**
 * POST /api/land-acquisition/select-listing
 * Client confirms a published catalog asset — this is when a deal starts.
 */
router.post('/select-listing', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const listingId = String(req.body?.listingId || '').trim();
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!listingId) return res.status(400).json({ error: 'listingId is required' });

    const existing = await prisma.landAcquisitionRequest.findFirst({
      where: { userId, listingId },
      include: dealInclude,
    });
    if (existing) {
      return res.json({ success: true, deal: existing, alreadySelected: true });
    }

    const deal = await prisma.$transaction(async (tx) => {
      const listing = await tx.landListing.findUnique({ where: { id: listingId } });
      if (!listing) {
        const err = new Error('Listing not found');
        (err as any).status = 404;
        throw err;
      }

      const reserved = await tx.landListing.updateMany({
        where: { id: listingId, status: LandListingStatus.PUBLISHED },
        data: { status: LandListingStatus.RESERVED },
      });
      if (reserved.count !== 1) {
        const err = new Error('This listing is not available');
        (err as any).status = 409;
        throw err;
      }

      const profile = await tx.landAcquisitionRequest.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      const unbound = await tx.landAcquisitionRequest.findFirst({
        where: { userId, listingId: null },
        orderBy: { createdAt: 'desc' },
      });

      const data = {
        listingId,
        status: LandRequestStatus.PLOT_SELECTED,
        currentStep: LandRequestStep.CONFIRMATION,
        plotReference: listing.title,
        contactName: unbound?.contactName || profile?.contactName || null,
        contactEmail: unbound?.contactEmail || profile?.contactEmail || null,
        purpose: unbound?.purpose || profile?.purpose || null,
        walletAddress: unbound?.walletAddress || profile?.walletAddress || null,
      };

      if (unbound) {
        return tx.landAcquisitionRequest.update({
          where: { id: unbound.id },
          data,
          include: dealInclude,
        });
      }
      return tx.landAcquisitionRequest.create({
        data: { userId, ...data },
        include: dealInclude,
      });
    });

    await notify(
      userId,
      'Deal started',
      `You selected ${deal.listing?.title || 'an asset'}. Diligence starts next.`,
      `/dashboard/deals/${deal.id}`
    );
    await notifyLandAdmins(
      'New deal',
      `${deal.contactName || 'A buyer'} selected ${deal.listing?.title || 'a listing'}.`,
      '/admin/land'
    );

    return res.json({ success: true, deal, alreadySelected: false });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('[LandAcquisition] POST select-listing error:', err);
    return res.status(500).json({ error: 'Failed to select listing' });
  }
});

/**
 * GET /api/land-acquisition/deals
 */
router.get('/deals', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const deals = await prisma.landAcquisitionRequest.findMany({
      where: { userId, listingId: { not: null } },
      orderBy: { updatedAt: 'desc' },
      include: dealInclude,
    });
    return res.json(deals);
  } catch (err) {
    console.error('[LandAcquisition] GET deals error:', err);
    return res.status(500).json({ error: 'Failed to fetch deals' });
  }
});

/**
 * GET /api/land-acquisition/deals/:id
 */
router.get('/deals/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const deal = await prisma.landAcquisitionRequest.findFirst({
      where: { id, userId, listingId: { not: null } },
      include: dealInclude,
    });
    if (!deal) return res.status(404).json({ error: 'Deal not found' });
    return res.json(deal);
  } catch (err) {
    console.error('[LandAcquisition] GET deal error:', err);
    return res.status(500).json({ error: 'Failed to fetch deal' });
  }
});

/**
 * GET /api/land-acquisition/submissions
 */
router.get('/submissions', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const listings = await prisma.landListing.findMany({
      where: { submittedByUserId: userId },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(listings);
  } catch (err) {
    console.error('[LandAcquisition] GET submissions error:', err);
    return res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

/**
 * POST /api/land-acquisition/submissions
 */
router.post('/submissions', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { title, kind, location, description, askingPrice, fileName, media, region } = req.body || {};
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'title is required' });
    if (!location || !String(location).trim()) return res.status(400).json({ error: 'location is required' });

    const listing = await prisma.landListing.create({
      data: {
        title: String(title).trim(),
        fullAddress: String(location).trim(),
        description: description != null && String(description).trim() ? String(description).trim() : null,
        kind: parseKind(kind),
        region: region != null && String(region).trim() ? String(region).trim() : null,
        listPrice: parseOptionalPrice(askingPrice),
        media:
          media != null
            ? media
            : fileName
              ? { files: [{ name: String(fileName) }] }
              : undefined,
        status: LandListingStatus.PENDING_VETTING,
        submittedByUserId: userId,
      },
    });

    await notify(
      userId,
      'Asset submitted',
      `${listing.title} is in the vetting queue.`,
      '/dashboard/upload'
    );
    await notifyLandAdmins(
      'New asset for vetting',
      `${listing.title} was submitted and needs review.`,
      '/admin/land'
    );

    return res.json({ success: true, listing });
  } catch (err) {
    console.error('[LandAcquisition] POST submissions error:', err);
    return res.status(500).json({ error: 'Failed to submit listing' });
  }
});

/**
 * GET /api/land-acquisition/notifications
 */
router.get('/notifications', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const unreadOnly = String(req.query.unread || '') === '1';
    const notifications = await prisma.landNotification.findMany({
      where: { userId, ...(unreadOnly ? { read: false } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return res.json(notifications);
  } catch (err) {
    console.error('[LandAcquisition] GET notifications error:', err);
    return res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

/**
 * PATCH /api/land-acquisition/notifications/read
 */
router.patch('/notifications/read', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id: unknown) => String(id)) : [];
    const all = req.body?.all === true;
    if (!all && ids.length === 0) return res.status(400).json({ error: 'ids or all is required' });

    await prisma.landNotification.updateMany({
      where: all ? { userId, read: false } : { userId, id: { in: ids } },
      data: { read: true },
    });
    return res.json({ success: true });
  } catch (err) {
    console.error('[LandAcquisition] PATCH notifications error:', err);
    return res.status(500).json({ error: 'Failed to update notifications' });
  }
});

// Admin check: user.isLandAdmin OR email in ADMIN_EMAILS (bootstrap).
// SizWallet sessions often have a placeholder email — look up by user id too.
const requireLandAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const email = req.user?.email;
    if (!userId && !email) return res.status(401).json({ error: 'Unauthorized' });

    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (email && adminEmails.length > 0 && adminEmails.includes(email.toLowerCase())) {
      return next();
    }

    const or: Array<{ id?: string; email?: { equals: string; mode: 'insensitive' } }> = [];
    if (userId) or.push({ id: userId });
    if (email) or.push({ email: { equals: email, mode: 'insensitive' } });

    const dbUser = await prisma.user.findFirst({
      where: { OR: or },
      select: { isLandAdmin: true, email: true },
    });
    if (dbUser?.isLandAdmin) return next();
    if (dbUser?.email && adminEmails.includes(dbUser.email.toLowerCase())) return next();

    return res.status(403).json({ error: 'Land admin access required' });
  } catch (err) {
    console.error('[LandAcquisition] requireLandAdmin error:', err);
    return res.status(500).json({
      error: 'Land admin check failed',
      hint: 'If this started after a deploy, run prisma migrate deploy on the Railway service (missing User.isLandAdmin or related columns).',
    });
  }
};

router.use('/admin', requireLandAdmin);

/**
 * GET /api/land-acquisition/admin/access
 * Cheap land-admin probe for post-login routing.
 */
router.get('/admin/access', async (_req: Request, res: Response) => {
  return res.json({ landAdmin: true });
});

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
        listing: true,
        documents: true,
        plots: { include: { images: true, satelliteVerification: true } },
        selectedPlot: { include: { images: true, satelliteVerification: true } },
      },
    });
    return res.json(requests);
  } catch (err) {
    console.error('[LandAcquisition] Admin GET requests error:', err);
    return res.status(500).json({
      error: 'Failed to fetch requests',
      hint: 'Often a schema drift issue: ensure Railway ran `npx prisma migrate deploy` after pulling migrations (LandPlot geo + SatelliteVerification + User.isLandAdmin).',
    });
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

    const prev = await prisma.landAcquisitionRequest.findUnique({
      where: { id },
      include: { listing: true },
    });
    if (!prev) return res.status(404).json({ error: 'Request not found' });

    const request = await prisma.landAcquisitionRequest.update({
      where: { id },
      data: { status },
      include: { listing: true },
    });

    if (status === LandRequestStatus.COMPLETED && prev.listingId) {
      await prisma.landListing.update({
        where: { id: prev.listingId },
        data: { status: LandListingStatus.SOLD },
      });
    } else if (
      status === LandRequestStatus.CANCELLED &&
      prev.listingId &&
      prev.listing?.status === LandListingStatus.RESERVED
    ) {
      await prisma.landListing.update({
        where: { id: prev.listingId },
        data: { status: LandListingStatus.PUBLISHED },
      });
    }

    await notify(
      prev.userId,
      'Deal status updated',
      `Your deal is now ${status.replace(/_/g, ' ').toLowerCase()}.`,
      prev.listingId ? `/dashboard/deals/${prev.id}` : '/dashboard/deals'
    );

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

    const deal = await prisma.landAcquisitionRequest.findUnique({
      where: { id: requestId },
      select: { id: true, userId: true, listingId: true },
    });
    if (!deal) return res.status(404).json({ error: 'Request not found' });

    const doc = await prisma.landAcquisitionDocument.create({
      data: {
        requestId,
        type: String(type),
        fileUrl: String(fileUrl),
        fileHash: fileHash ? String(fileHash) : null,
        uploadedBy: uploadedBy || null,
      },
    });

    await notify(
      deal.userId,
      'New diligence document',
      `${String(type)} was added to your deal.`,
      deal.listingId ? `/dashboard/deals/${deal.id}` : '/dashboard/deals'
    );

    return res.json({ success: true, document: doc });
  } catch (err) {
    console.error('[LandAcquisition] Admin POST documents error:', err);
    return res.status(500).json({ error: 'Failed to upload document' });
  }
});

function parseOptionalLatLng(latitude: unknown, longitude: unknown): { lat: number | null; lng: number | null } {
  let latNum: number | null = null;
  let lngNum: number | null = null;
  if (latitude != null && latitude !== '') {
    latNum = Number(latitude);
    if (isNaN(latNum) || latNum < -90 || latNum > 90) {
      throw new Error('latitude must be between -90 and 90');
    }
  }
  if (longitude != null && longitude !== '') {
    lngNum = Number(longitude);
    if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
      throw new Error('longitude must be between -180 and 180');
    }
  }
  return { lat: latNum, lng: lngNum };
}

/**
 * GET /api/land-acquisition/admin/catalog/listings
 */
router.get('/admin/catalog/listings', async (_req: Request, res: Response) => {
  try {
    const listings = await prisma.landListing.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        submittedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
        _count: { select: { deals: true } },
      },
    });
    return res.json(listings);
  } catch (err) {
    console.error('[LandAcquisition] Admin GET catalog error:', err);
    return res.status(500).json({ error: 'Failed to fetch catalog listings' });
  }
});

/**
 * POST /api/land-acquisition/admin/catalog/listings
 */
router.post('/admin/catalog/listings', async (req: Request, res: Response) => {
  try {
    const {
      title,
      description,
      fullAddress,
      listPrice,
      currency,
      latitude,
      longitude,
      boundaryGeoJSON,
      status,
      kind,
      region,
      badges,
    } = req.body;
    if (!title || !fullAddress) {
      return res.status(400).json({ error: 'title and fullAddress are required' });
    }
    let latLng: { lat: number | null; lng: number | null };
    try {
      latLng = parseOptionalLatLng(latitude, longitude);
    } catch (e: any) {
      return res.status(400).json({ error: e.message || 'Invalid coordinates' });
    }

    const parsedStatus = parseListingStatus(status);
    const listing = await prisma.landListing.create({
      data: {
        title: String(title).trim(),
        description: description != null ? String(description).trim() : null,
        fullAddress: String(fullAddress).trim(),
        listPrice: listPrice != null && listPrice !== '' ? Number(listPrice) : null,
        currency: currency != null && String(currency).trim() ? String(currency).trim() : 'USD',
        latitude: latLng.lat,
        longitude: latLng.lng,
        boundaryGeoJSON: boundaryGeoJSON ?? undefined,
        kind: parseKind(kind),
        region: region != null && String(region).trim() ? String(region).trim() : null,
        badges: Array.isArray(badges) ? badges.map((b: unknown) => String(b)).filter(Boolean) : [],
        status: parsedStatus || LandListingStatus.DRAFT,
      },
    });
    return res.json({ success: true, listing });
  } catch (err) {
    console.error('[LandAcquisition] Admin POST catalog error:', err);
    return res.status(500).json({ error: 'Failed to create listing' });
  }
});

/**
 * PATCH /api/land-acquisition/admin/catalog/listings/:id
 */
router.patch('/admin/catalog/listings/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'id required' });
    const {
      title,
      description,
      fullAddress,
      listPrice,
      currency,
      latitude,
      longitude,
      boundaryGeoJSON,
      status,
      kind,
      region,
      badges,
    } = req.body;

    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = String(title).trim();
    if (description !== undefined) data.description = description != null ? String(description).trim() : null;
    if (fullAddress !== undefined) data.fullAddress = String(fullAddress).trim();
    if (listPrice !== undefined) data.listPrice = listPrice === '' || listPrice == null ? null : Number(listPrice);
    if (currency !== undefined) data.currency = currency != null ? String(currency).trim() : 'USD';
    if (latitude !== undefined || longitude !== undefined) {
      const cur = await prisma.landListing.findUnique({ where: { id }, select: { latitude: true, longitude: true } });
      const latIn = latitude !== undefined ? latitude : cur?.latitude;
      const lngIn = longitude !== undefined ? longitude : cur?.longitude;
      try {
        const ll = parseOptionalLatLng(latIn, lngIn);
        data.latitude = ll.lat;
        data.longitude = ll.lng;
      } catch (e: any) {
        return res.status(400).json({ error: e.message || 'Invalid coordinates' });
      }
    }
    if (boundaryGeoJSON !== undefined) data.boundaryGeoJSON = boundaryGeoJSON;
    if (kind !== undefined) data.kind = parseKind(kind);
    if (region !== undefined) data.region = region != null && String(region).trim() ? String(region).trim() : null;
    if (badges !== undefined) {
      data.badges = Array.isArray(badges) ? badges.map((b: unknown) => String(b)).filter(Boolean) : [];
    }
    if (status !== undefined) {
      const parsedStatus = parseListingStatus(status);
      if (!parsedStatus) return res.status(400).json({ error: 'Invalid listing status' });
      data.status = parsedStatus;
    }

    const listing = await prisma.landListing.update({
      where: { id },
      data: data as any,
    });
    return res.json({ success: true, listing });
  } catch (err) {
    console.error('[LandAcquisition] Admin PATCH catalog error:', err);
    return res.status(500).json({ error: 'Failed to update listing' });
  }
});

/**
 * DELETE /api/land-acquisition/admin/catalog/listings/:id
 */
router.delete('/admin/catalog/listings/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'id required' });
    await prisma.landListing.delete({ where: { id } });
    return res.json({ success: true });
  } catch (err) {
    console.error('[LandAcquisition] Admin DELETE catalog error:', err);
    return res.status(500).json({ error: 'Failed to delete listing' });
  }
});

/**
 * GET /api/land-acquisition/admin/submissions
 */
router.get('/admin/submissions', async (_req: Request, res: Response) => {
  try {
    const listings = await prisma.landListing.findMany({
      where: { submittedByUserId: { not: null } },
      orderBy: { createdAt: 'desc' },
      include: {
        submittedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
        _count: { select: { deals: true } },
      },
    });
    return res.json(listings);
  } catch (err) {
    console.error('[LandAcquisition] Admin GET submissions error:', err);
    return res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

/**
 * POST /api/land-acquisition/admin/submissions/:id/review
 */
router.post('/admin/submissions/:id/review', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const action = String(req.body?.action || '').toLowerCase();
    const reason = req.body?.reason != null ? String(req.body.reason).trim() : '';
    if (!id) return res.status(400).json({ error: 'id required' });
    if (action !== 'approve' && action !== 'reject') {
      return res.status(400).json({ error: 'action must be approve or reject' });
    }
    if (action === 'reject' && !reason) {
      return res.status(400).json({ error: 'rejection reason is required' });
    }

    const listing = await prisma.landListing.findUnique({ where: { id } });
    if (!listing) return res.status(404).json({ error: 'Submission not found' });
    if (listing.status !== LandListingStatus.PENDING_VETTING && listing.status !== LandListingStatus.REJECTED) {
      return res.status(409).json({ error: 'Submission is not awaiting vetting' });
    }

    const updated = await prisma.landListing.update({
      where: { id },
      data:
        action === 'approve'
          ? { status: LandListingStatus.PUBLISHED, rejectionReason: null }
          : { status: LandListingStatus.REJECTED, rejectionReason: reason },
    });

    if (listing.submittedByUserId) {
      await notify(
        listing.submittedByUserId,
        action === 'approve' ? 'Asset published' : 'Asset not approved',
        action === 'approve'
          ? `${listing.title} is now in the public catalog.`
          : `${listing.title} was not approved. ${reason}`,
        '/dashboard/upload'
      );
    }

    return res.json({ success: true, listing: updated });
  } catch (err) {
    console.error('[LandAcquisition] Admin POST review error:', err);
    return res.status(500).json({ error: 'Failed to review submission' });
  }
});

export default router;
