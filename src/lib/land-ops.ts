import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';

export const FILE_META_SELECT = {
  id: true,
  filename: true,
  mimeType: true,
  byteSize: true,
  kind: true,
  listingId: true,
  requestId: true,
  uploadedByUserId: true,
  createdAt: true,
} as const;

export const DILIGENCE_DEFAULTS = [
  { key: 'BUYER_KYC', label: 'Buyer legal identity on file' },
  { key: 'TITLE_SEARCH', label: 'Title / registry search' },
  { key: 'SITE_VISIT', label: 'On-ground site visit' },
  { key: 'SURVEY', label: 'Licensed survey' },
  { key: 'LEGAL_MEMO', label: 'Legal due diligence memo' },
  { key: 'SATELLITE_VERIFY', label: 'Satellite / EO verification' },
  { key: 'SALE_AGREEMENT', label: 'Sale agreement drafted' },
] as const;

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 5;

export type ParsedUpload = {
  filename: string;
  mimeType: string;
  byteSize: number;
  data: Buffer;
  kind: string;
};

export function parseKindLabel(raw: unknown): string {
  const k = String(raw || 'OTHER').toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 32);
  return k || 'OTHER';
}

export function parseUploadedFiles(body: any): ParsedUpload[] {
  const rawList = Array.isArray(body?.files)
    ? body.files
    : body?.dataBase64
      ? [body]
      : [];
  if (rawList.length > MAX_FILES_PER_UPLOAD) {
    throw Object.assign(new Error(`At most ${MAX_FILES_PER_UPLOAD} files per request`), { status: 400 });
  }
  return rawList.map((item: any, i: number) => {
    const str = String(item?.dataBase64 || item?.data || '');
    const b64 = str.includes(',') ? str.split(',')[1] : str;
    if (!b64) {
      throw Object.assign(new Error(`File ${i + 1} is empty`), { status: 400 });
    }
    const data = Buffer.from(b64, 'base64');
    if (!data.length) {
      throw Object.assign(new Error(`File ${i + 1} is empty`), { status: 400 });
    }
    if (data.length > MAX_FILE_BYTES) {
      throw Object.assign(new Error(`File ${i + 1} exceeds 5MB`), { status: 400 });
    }
    return {
      filename: String(item?.filename || item?.name || `upload-${i + 1}`).slice(0, 180),
      mimeType: String(item?.mimeType || item?.type || 'application/octet-stream').slice(0, 120),
      byteSize: data.length,
      data,
      kind: parseKindLabel(item?.kind),
    };
  });
}

export async function recordAudit(input: {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  meta?: Record<string, unknown>;
}) {
  try {
    await prisma.landAuditEvent.create({
      data: {
        actorUserId: input.actorUserId || null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        summary: input.summary,
        meta: input.meta
          ? (JSON.parse(JSON.stringify(input.meta)) as Prisma.InputJsonValue)
          : undefined,
      },
    });
  } catch (err) {
    console.warn('[LandOps] audit write failed', err);
  }
}

export async function seedDiligence(requestId: string) {
  await prisma.landDiligenceItem.createMany({
    data: DILIGENCE_DEFAULTS.map((item) => ({
      requestId,
      key: item.key,
      label: item.label,
    })),
    skipDuplicates: true,
  });
}

export function optionalTrim(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw == null) return null;
  const s = String(raw).trim();
  return s ? s : null;
}
