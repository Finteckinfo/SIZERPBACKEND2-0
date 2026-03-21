/**
 * Sentinel Hub / Copernicus Data Space Ecosystem integration.
 * Fetches Sentinel-2 imagery via Process API.
 * Set SENTINEL_HUB_CLIENT_ID and SENTINEL_HUB_CLIENT_SECRET to enable.
 */

const CDSE_TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const CDSE_PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';

// Commercial Sentinel Hub (alternative - use if you have instance ID)
const SH_TOKEN_URL = 'https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token';
const SH_PROCESS_URL = 'https://services.sentinel-hub.com/api/v1/process';

const EVALSCRIPT_TRUE_COLOR = `//VERSION=3
function setup() {
  return {
    input: ["B02", "B03", "B04"],
    output: { bands: 3, sampleType: "AUTO" }
  };
}
function evaluatePixel(sample) {
  return [2.5 * sample.B04, 2.5 * sample.B03, 2.5 * sample.B02];
}`;

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string | null> {
  const clientId = process.env.SENTINEL_HUB_CLIENT_ID;
  const clientSecret = process.env.SENTINEL_HUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;

  // Reuse token if still valid (with 5min buffer)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 300_000) {
    return cachedToken.token;
  }

  const useCdse = !process.env.SENTINEL_HUB_INSTANCE_ID;
  const tokenUrl = useCdse ? CDSE_TOKEN_URL : SH_TOKEN_URL;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      console.error('[SentinelHub] Token request failed:', res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    };
    return cachedToken.token;
  } catch (err) {
    console.error('[SentinelHub] Token error:', err);
    return null;
  }
}

/**
 * Fetch Sentinel-2 true-color image for the given bbox.
 * bbox: [minLon, minLat, maxLon, maxLat] in WGS84
 * Returns image bytes (JPEG) or null on failure.
 */
export async function fetchSentinelImagery(
  bbox: [number, number, number, number],
  width = 512,
  height = 512
): Promise<Buffer | null> {
  const token = await getToken();
  if (!token) return null;

  const processUrl = process.env.SENTINEL_HUB_INSTANCE_ID ? SH_PROCESS_URL : CDSE_PROCESS_URL;

  const from = new Date();
  from.setMonth(from.getMonth() - 6);
  const to = new Date();

  const requestBody = {
    input: {
      bounds: {
        properties: { crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' },
        bbox,
      },
      data: [
        {
          type: 'sentinel-2-l2a',
          dataFilter: {
            timeRange: {
              from: from.toISOString(),
              to: to.toISOString(),
            },
            maxCloudCoverage: 30,
          },
        },
      ],
    },
    output: {
      width,
      height,
      responses: [{ identifier: 'default', format: { type: 'image/jpeg', quality: 85 } }],
    },
    evalscript: EVALSCRIPT_TRUE_COLOR,
  };

  try {
    const res = await fetch(processUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[SentinelHub] Process API error:', res.status, text.slice(0, 500));
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.error('[SentinelHub] Fetch error:', err);
    return null;
  }
}

/**
 * Check if Sentinel Hub integration is configured.
 */
export function isSentinelHubConfigured(): boolean {
  return !!(process.env.SENTINEL_HUB_CLIENT_ID && process.env.SENTINEL_HUB_CLIENT_SECRET);
}
