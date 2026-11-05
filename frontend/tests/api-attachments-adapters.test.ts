import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError } from '@/api/errors';
import {
  MAX_ATTACHMENT_BYTES, UploadFailed, attachmentErrorText, awaitsScan, contentTypeOf, fileProblem, formatBytes, scanLook, sha256Hex, uploadFailureText,
} from '@/api/adapters/attachments';
import { putBytes } from '@/api/live/attachments';

const f = (name: string, type: string, size = 100) => ({ name, type, size });

describe('what may be attached', () => {
  it('takes the browser type when the server accepts it, else guesses from the extension', () => {
    expect(contentTypeOf(f('a.pdf', 'application/pdf'))).toBe('application/pdf');
    expect(contentTypeOf(f('statement.CSV', 'application/vnd.ms-excel'))).toBe('text/csv');
    expect(contentTypeOf(f('scan.jpeg', ''))).toBe('image/jpeg');
    expect(contentTypeOf(f('run.exe', 'application/x-msdownload'))).toBeNull();
    expect(contentTypeOf(f('noextension', ''))).toBeNull();
  });
  it('refuses empty, oversize and unknown files with the file name in the sentence', () => {
    expect(fileProblem(f('a.pdf', 'application/pdf', 0))).toMatch(/a\.pdf is empty/);
    expect(fileProblem(f('big.pdf', 'application/pdf', MAX_ATTACHMENT_BYTES + 1))).toMatch(/larger than 25 MB/);
    expect(fileProblem(f('x.exe', ''))).toMatch(/not a type that can be attached/);
    expect(fileProblem(f('ok.png', 'image/png', MAX_ATTACHMENT_BYTES))).toBeNull();
  });
  it('writes sizes in whole bytes, KB and MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(204800)).toBe('200 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB');
  });
});

describe('scan state', () => {
  it('reads each verdict', () => {
    expect(scanLook({ scan_status: 'clean', upload_completed: true })).toEqual({ label: 'Scanned, clean', tone: 'ok' });
    expect(scanLook({ scan_status: 'pending', upload_completed: true }).tone).toBe('wait');
    expect(scanLook({ scan_status: 'infected', upload_completed: true }).tone).toBe('bad');
    expect(scanLook({ scan_status: 'error', upload_completed: true }).label).toMatch(/Could not be scanned/);
    expect(scanLook({ scan_status: 'pending', upload_completed: false }).label).toBe('Upload not finished');
  });
  it('keeps refreshing only while a finished upload waits for its verdict', () => {
    expect(awaitsScan([{ scan_status: 'pending', upload_completed: true }])).toBe(true);
    expect(awaitsScan([{ scan_status: 'pending', upload_completed: false }, { scan_status: 'clean', upload_completed: true }])).toBe(false);
    expect(awaitsScan([])).toBe(false);
  });
});

describe('refusals', () => {
  const api = (status: number, code: string, extra: object = {}) => new ApiError({ status, code, detail: 'server words', ...extra });
  it('explains the evidence rule calmly', () => {
    expect(attachmentErrorText(api(422, 'attachment_immutable'))).toMatch(/evidence and cannot be removed/);
    expect(attachmentErrorText(api(422, 'attachment_type_not_allowed'))).toMatch(/Allowed: PDF/);
    expect(attachmentErrorText(api(422, 'attachment_mismatch'))).toMatch(/did not match/);
    expect(attachmentErrorText(api(403, 'forbidden'))).toMatch(/role/);
  });
  it('shows the first validation message, else the server sentence', () => {
    expect(attachmentErrorText(api(422, 'validation_failed', { errors: { size: ['The size must be at least 1.'] } }))).toBe('The size must be at least 1.');
    expect(attachmentErrorText(api(409, 'something_new'))).toBe('server words');
    expect(attachmentErrorText(new UploadFailed('The file could not be sent. Try again.'))).toBe('The file could not be sent. Try again.');
  });
  it('words the signed-address failures', () => {
    expect(uploadFailureText(403)).toMatch(/expired/);
    expect(uploadFailureText(413)).toMatch(/too large/);
    expect(uploadFailureText(500)).toMatch(/could not be sent/);
  });
});

describe('fingerprint and upload', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('hashes bytes as lower-case hex SHA-256', async () => {
    const bytes = new TextEncoder().encode('abc');
    expect(await sha256Hex(bytes.buffer as ArrayBuffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('sends the bytes to the signed address without the session cookie', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const blob = new Blob(['x']);
    await putBytes({ url: 'http://h/api/attachment-uploads/t/f?signature=s', method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, expires_at: null }, blob);
    expect(fetchMock).toHaveBeenCalledWith('http://h/api/attachment-uploads/t/f?signature=s', { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: blob, credentials: 'omit' });
  });
  it('turns a refused upload into a sentence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 403 })));
    await expect(putBytes({ url: 'u', method: 'PUT', headers: {}, expires_at: null }, new Blob(['x']))).rejects.toThrow(/expired/);
  });
});
