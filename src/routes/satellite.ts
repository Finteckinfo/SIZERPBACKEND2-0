import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/performance.js';
import { prisma } from '../utils/prisma.js';
import { getRedisClient } from '../services/redis.js';
import { fetchSentinelImagery, isSentinelHubConfigured } from '../services/sentinel-hub.js';

const router = Router();
router.use(authenticateToken);
router.use(rateLimiter(60, 60000)); // 60 req/min per user for external API protection

const REDIS_PREFIX = 'sizland:satellite:imagery:';
const REDIS_IMAGE_PREFIX = 'sizland:satellite:image:';
const CACHE_TTL_SUCCESS = 86400; // 24h for imagery URLs
const CACHE_TTL_NO_IMAGERY = 300; // 5min for "no coords" / "no imagery"
const CACHE_TTL_IMAGE = 86400; // 24h for cached image bytes

function isValidPlotId(id: string): boolean {
  return typeof id === 'string' && id.length >= 20 && id.length <= 30 && /^[a-z0-9_-]+$/.test(id);
}

/** Build imageryUrl for frontend (relative path - works with Sizland proxy) */
function imageryUrlForPlot(plotId: string): string {
  return `/api/satellite/imagery/${plotId}/image`;
}

/**
 * GET /api/satellite/imagery/batch?plotIds=id1,id2,id3
 * Batch imagery — 1 request instead of N. Max 20 plots. Define before /imagery.
 */
router.get('/imagery/batch', async (req: Request, res: Response) => {
  try {
    const raw = typeof req.query.plotIds === 'string' ? req.query.plotIds : '';
    const plotIds = raw
      .split(',')
      .map((s) => s.trim())
      .filter(isValidPlotId)
      .slice(0, 20);
    if (plotIds.length === 0) {
      return res.status(400).json({ error: 'At least one valid plotId required (max 20)' });
    }

    const redis = getRedisClient();
    const result: Record<string, object> = {};
    const toFetch: string[] = [];

    if (redis?.isOpen) {
      for (const id of plotIds) {
        const cached = await redis.get(`${REDIS_PREFIX}${id}`);
        if (cached) {
          try {
            result[id] = JSON.parse(cached) as object;
          } catch {
            toFetch.push(id);
          }
        } else {
          toFetch.push(id);
        }
      }
    } else {
      toFetch.push(...plotIds);
    }

    if (toFetch.length > 0) {
      const plots = await prisma.landPlot.findMany({
        where: { id: { in: toFetch } },
        include: { satelliteVerification: true },
      });
      const plotMap = new Map(plots.map((p) => [p.id, p]));
      for (const id of toFetch) {
        const plot = plotMap.get(id);
        const item: object = !plot
          ? { error: 'Plot not found' }
          : plot.latitude == null || plot.longitude == null
            ? { hasImagery: false, plotId: id, message: 'No coordinates' }
            : {
                hasImagery: true,
                plotId: id,
                latitude: plot.latitude,
                longitude: plot.longitude,
                imageryUrl: plot.satelliteVerification?.imageryUrl ?? null,
                lastImageryDate: plot.satelliteVerification?.lastImageryDate ?? null,
              };
        result[id] = item;
        if (redis?.isOpen && !('error' in item)) {
          const ttl = (item as { imageryUrl?: string | null }).imageryUrl
            ? CACHE_TTL_SUCCESS
            : CACHE_TTL_NO_IMAGERY;
          await redis.setEx(`${REDIS_PREFIX}${id}`, ttl, JSON.stringify(item));
        }
      }
    }

    return res.json(result);
  } catch (err) {
    console.error('[Satellite] GET imagery/batch error:', err);
    return res.status(500).json({ error: 'Failed to fetch satellite imagery' });
  }
});

/**
 * GET /api/satellite/imagery/:plotId/image
 * Returns raw Sentinel-2 image (JPEG) for use in img src.
 * Define before /imagery to avoid :plotId matching "batch".
 */
router.get('/imagery/:plotId/image', async (req: Request, res: Response) => {
  try {
    const plotId = typeof req.params.plotId === 'string' ? req.params.plotId.trim() : null;
    if (!plotId || !isValidPlotId(plotId)) {
      return res.status(400).send('Invalid plotId');
    }

    const redis = getRedisClient();
    if (redis?.isOpen) {
      const cached = await redis.get(`${REDIS_IMAGE_PREFIX}${plotId}`);
      if (cached) {
        const buf = Buffer.from(cached, 'base64');
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', `public, max-age=${CACHE_TTL_IMAGE}`);
        return res.send(buf);
      }
    }

    const plot = await prisma.landPlot.findUnique({
      where: { id: plotId },
      include: { satelliteVerification: true },
    });

    if (!plot || plot.latitude == null || plot.longitude == null) {
      return res.status(404).send('Plot not found or has no coordinates');
    }

    if (!isSentinelHubConfigured()) {
      return res.status(503).send('Satellite imagery service not configured');
    }

    const delta = 0.005;
    const bbox: [number, number, number, number] = [
      plot.longitude - delta,
      plot.latitude - delta,
      plot.longitude + delta,
      plot.latitude + delta,
    ];
    const imageBuffer = await fetchSentinelImagery(bbox);
    if (!imageBuffer) {
      return res.status(502).send('Failed to fetch satellite imagery');
    }

    if (redis?.isOpen) {
      await redis.setEx(
        `${REDIS_IMAGE_PREFIX}${plotId}`,
        CACHE_TTL_IMAGE,
        imageBuffer.toString('base64')
      );
    }

    await prisma.satelliteVerification.upsert({
      where: { plotId },
      create: {
        plotId,
        imageryUrl: imageryUrlForPlot(plotId),
        lastImageryDate: new Date(),
        hasVerified: false,
      },
      update: {
        imageryUrl: imageryUrlForPlot(plotId),
        lastImageryDate: new Date(),
      },
    });

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', `public, max-age=${CACHE_TTL_IMAGE}`);
    return res.send(imageBuffer);
  } catch (err) {
    console.error('[Satellite] GET image error:', err);
    return res.status(500).send('Internal server error');
  }
});

/**
 * GET /api/satellite/imagery?plotId=xxx
 * Single-plot imagery. Caches in Redis.
 */
router.get('/imagery', async (req: Request, res: Response) => {
  try {
    const plotId = typeof req.query.plotId === 'string' ? req.query.plotId.trim() : null;
    if (!plotId || !isValidPlotId(plotId)) {
      return res.status(400).json({ error: 'Valid plotId is required' });
    }

    const redis = getRedisClient();
    if (redis?.isOpen) {
      const cached = await redis.get(`${REDIS_PREFIX}${plotId}`);
      if (cached) return res.json(JSON.parse(cached));
    }

    const plot = await prisma.landPlot.findUnique({
      where: { id: plotId },
      include: { satelliteVerification: true },
    });

    if (!plot) return res.status(404).json({ error: 'Plot not found' });

    if (plot.latitude == null || plot.longitude == null) {
      const result = {
        hasImagery: false,
        plotId,
        message: 'Plot has no coordinates. Add latitude/longitude for satellite imagery.',
      };
      if (redis?.isOpen) {
        await redis.setEx(`${REDIS_PREFIX}${plotId}`, CACHE_TTL_NO_IMAGERY, JSON.stringify(result));
      }
      return res.json(result);
    }

    let imageryUrl = plot.satelliteVerification?.imageryUrl ?? null;
    let lastImageryDate = plot.satelliteVerification?.lastImageryDate ?? null;

    // Fetch from Sentinel Hub when configured and we don't have cached imagery
    if (isSentinelHubConfigured() && !imageryUrl) {
      const delta = 0.005;
      const bbox: [number, number, number, number] = [
        plot.longitude - delta,
        plot.latitude - delta,
        plot.longitude + delta,
        plot.latitude + delta,
      ];
      const imageBuffer = await fetchSentinelImagery(bbox);
      if (imageBuffer) {
        imageryUrl = imageryUrlForPlot(plotId);
        lastImageryDate = new Date();

        // Cache image bytes in Redis for the image endpoint
        if (redis?.isOpen) {
          await redis.setEx(
            `${REDIS_IMAGE_PREFIX}${plotId}`,
            CACHE_TTL_IMAGE,
            imageBuffer.toString('base64')
          );
        }

        // Upsert SatelliteVerification
        await prisma.satelliteVerification.upsert({
          where: { plotId },
          create: {
            plotId,
            imageryUrl,
            lastImageryDate,
            hasVerified: false,
          },
          update: {
            imageryUrl,
            lastImageryDate,
          },
        });
      }
    }

    const result = {
      hasImagery: true,
      plotId,
      latitude: plot.latitude,
      longitude: plot.longitude,
      imageryUrl,
      lastImageryDate:
        lastImageryDate instanceof Date ? lastImageryDate.toISOString() : lastImageryDate ?? null,
      wmsUrl: process.env.SENTINEL_WMS_URL
        ? `${process.env.SENTINEL_WMS_URL}&bbox=${plot.longitude - 0.01},${plot.latitude - 0.01},${plot.longitude + 0.01},${plot.latitude + 0.01}`
        : null,
    };

    if (redis?.isOpen) {
      const ttl = result.imageryUrl ? CACHE_TTL_SUCCESS : CACHE_TTL_NO_IMAGERY;
      await redis.setEx(`${REDIS_PREFIX}${plotId}`, ttl, JSON.stringify(result));
    }

    return res.json(result);
  } catch (err) {
    console.error('[Satellite] GET imagery error:', err);
    return res.status(500).json({ error: 'Failed to fetch satellite imagery' });
  }
});

export default router;
