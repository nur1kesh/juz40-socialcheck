import { mkdir, writeFile, readFile, unlink } from 'fs/promises';
import path from 'path';
import { randomToken } from '@/lib/crypto';

// Local-disk storage for dev. In production, swap for an S3-compatible
// bucket with private ACLs — the interface (save/read by opaque key) stays
// the same, and the key is never exposed as a public URL.
const STORAGE_ROOT = path.join(process.cwd(), 'storage', 'documents');

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export async function saveDocumentFile(buffer: Buffer, extension: string): Promise<string> {
  await mkdir(STORAGE_ROOT, { recursive: true });
  const key = `${randomToken(16)}${extension}`;
  await writeFile(path.join(STORAGE_ROOT, key), buffer);
  return key; // opaque storage key, stored as Document.filePath
}

export async function readDocumentFile(key: string): Promise<Buffer> {
  const safeKey = path.basename(key); // defense in depth against path traversal
  return readFile(path.join(STORAGE_ROOT, safeKey));
}

// Used when an application is rejected: the uploaded document images are
// personal data with no further purpose once there's no discount to
// support, so they're deleted rather than kept indefinitely.
export async function deleteDocumentFile(key: string): Promise<void> {
  const safeKey = path.basename(key);
  await unlink(path.join(STORAGE_ROOT, safeKey)).catch(() => {});
}

export function extensionForMime(mime: string): string {
  switch (mime) {
    case 'application/pdf':
      return '.pdf';
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    default:
      throw new Error('Қолдау көрсетілмейтін файл түрі');
  }
}

// Checks the first bytes of the file against known magic numbers so a
// renamed .exe can't slip through just because the client sent a nice
// Content-Type / extension.
export function verifyFileSignature(buffer: Buffer, mime: string): boolean {
  const sig = buffer.subarray(0, 8);
  if (mime === 'application/pdf') {
    return sig.subarray(0, 4).toString('ascii') === '%PDF';
  }
  if (mime === 'image/jpeg') {
    return sig[0] === 0xff && sig[1] === 0xd8;
  }
  if (mime === 'image/png') {
    return sig.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return false;
}
