/**
 * Attachments (plan 2.17, step 3c.2): which parents take files, what a file must be before it is sent, how the scan
 * state reads, and the words for each refusal. Pure functions. The server decides every rule; this only avoids sending
 * a file it will certainly refuse, and says why in plain words when it does.
 */
import { ApiError } from '../errors';
import { describeError } from '../messages';
import type { components } from '../schema';

export type ApiAttachment = components['schemas']['AttachmentResource'];
export type AttachableType = 'journal' | 'invoice' | 'bill' | 'contact' | 'settlement';

/** The server's limit (config attachments.max_bytes, 25 MB). A smaller limit on the server still wins. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Content types the server accepts, with the extensions a browser may leave without a type. */
const TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  txt: 'text/plain',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const ALLOWED_TYPES = new Set(Object.values(TYPE_BY_EXTENSION));

export const ALLOWED_SUMMARY = 'PDF, images (PNG, JPEG, GIF, WebP), text and CSV, Word (.docx) and Excel (.xlsx) files, up to 25 MB';
export const ACCEPT = Object.keys(TYPE_BY_EXTENSION).map((e) => `.${e}`).join(',');

/** The content type to announce: the browser's, when the server accepts it, else guessed from the extension. */
export function contentTypeOf(file: Pick<File, 'name' | 'type'>): string | null {
  if (ALLOWED_TYPES.has(file.type)) return file.type;
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  return TYPE_BY_EXTENSION[ext] ?? null;
}

/** A reason this file cannot be attached, or null. The server checks again, including the real content type. */
export function fileProblem(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  if (file.size < 1) return `${file.name} is empty.`;
  if (file.size > MAX_ATTACHMENT_BYTES) return `${file.name} is larger than 25 MB.`;
  if (contentTypeOf(file) === null) return `${file.name} is not a type that can be attached. Allowed: ${ALLOWED_SUMMARY}.`;
  return null;
}

/** "1.2 MB". Whole numbers of bytes in, text out; no money here. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export type ScanLook = { label: string; tone: 'wait' | 'ok' | 'bad' | 'warn' };

/** How a file's scan state reads. A file that has not finished uploading is not scanned yet. */
export function scanLook(a: Pick<ApiAttachment, 'scan_status' | 'upload_completed'>): ScanLook {
  if (!a.upload_completed) return { label: 'Upload not finished', tone: 'warn' };
  switch (a.scan_status) {
    case 'clean':
      return { label: 'Scanned, clean', tone: 'ok' };
    case 'infected':
      return { label: 'Blocked: virus found', tone: 'bad' };
    case 'error':
      return { label: 'Could not be scanned', tone: 'bad' };
    default:
      return { label: 'Being scanned', tone: 'wait' };
  }
}

/** True while a file is waiting for its verdict, so the list keeps refreshing. */
export const awaitsScan = (list: Pick<ApiAttachment, 'scan_status' | 'upload_completed'>[]): boolean => list.some((a) => a.upload_completed && a.scan_status === 'pending');

const CODE_TEXT: Record<string, string> = {
  attachment_too_large: 'That file is empty or larger than 25 MB.',
  attachment_type_not_allowed: `That file type is not allowed. Allowed: ${ALLOWED_SUMMARY}.`,
  attachment_mismatch: 'The file that arrived did not match the one you chose, so it was thrown away. Try again.',
  attachment_not_uploaded: 'The file did not finish uploading. Try again.',
  attachment_immutable: 'Files on a posted document are evidence and cannot be removed. You can still add new ones.',
  attachable_not_found: 'The document these files belong to could not be found.',
  upload_too_large: 'The upload was larger than announced, so it was refused.',
  forbidden: 'Your role does not allow this on this document.',
};

/** User text for a refusal from the attachment endpoints or the upload itself. */
export function attachmentErrorText(e: unknown): string {
  if (e instanceof UploadFailed) return e.message;
  if (e instanceof ApiError) {
    const known = CODE_TEXT[e.code];
    if (known) return known;
    const first = e.errors ? Object.values(e.errors).flat()[0] : undefined;
    if (e.status === 422 && first) return first;
  }
  return describeError(e);
}

/** The signed upload address refused or could not be reached. */
export class UploadFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadFailed';
  }
}

export function uploadFailureText(status: number): string {
  if (status === 403) return 'The upload link expired or was already used. Try adding the file again.';
  if (status === 413) return 'The server refused the file as too large.';
  return 'The file could not be sent. Try again.';
}

/** Lower-case hex SHA-256 of the bytes, which the server checks against what arrives. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new UploadFailed('This browser cannot prepare a file from an insecure page. Open the app over HTTPS.');
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}
