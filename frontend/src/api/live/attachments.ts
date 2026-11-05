/** Live attachment calls (13 §17): ask for an upload, send the bytes to the signed address, complete, list, download, remove. */
import { NetworkError } from '../errors';
import { http } from '../http';
import type { Intent } from '../idempotency';
import { UploadFailed, uploadFailureText, type ApiAttachment, type AttachableType } from '../adapters/attachments';

const base = (company: string) => `/v1/companies/${company}/attachments`;

export interface UploadTarget {
  url: string;
  method: string;
  headers: Record<string, string>;
  expires_at: string | null;
}

export const listAttachments = async (company: string, type: AttachableType, id: string): Promise<ApiAttachment[]> => {
  const qs = new URLSearchParams({ attachable_type: type, attachable_id: id, limit: '200' });
  return (await http.send<{ data: ApiAttachment[] }>('GET', `${base(company)}?${qs.toString()}`)).data;
};

export interface UploadRequest {
  attachable_type: AttachableType;
  attachable_id: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
}

export const requestUpload = async (company: string, body: UploadRequest, intent: Intent): Promise<{ attachment: ApiAttachment; upload: UploadTarget }> => {
  const res = await http.send<{ data: ApiAttachment; upload: UploadTarget }>('POST', `${base(company)}/uploads`, body, intent);
  return { attachment: res.data, upload: res.upload };
};

/**
 * The bytes go straight to the signed address, not through the API client: it carries its own credential in the URL, and
 * the request must not carry the session cookie (an object store on another origin would refuse it).
 */
export async function putBytes(target: UploadTarget, file: Blob): Promise<void> {
  let res: Response;
  try {
    res = await fetch(target.url, { method: target.method, headers: target.headers, body: file, credentials: 'omit' });
  } catch (e) {
    throw new NetworkError(e);
  }
  if (!res.ok) throw new UploadFailed(uploadFailureText(res.status));
}

export const completeUpload = async (company: string, id: string, intent: Intent): Promise<ApiAttachment> =>
  (await http.send<{ data: ApiAttachment }>('POST', `${base(company)}/${id}/complete`, undefined, intent)).data;

export const downloadTarget = async (company: string, id: string): Promise<{ url: string; filename: string }> =>
  (await http.send<{ data: { url: string; filename: string } }>('GET', `${base(company)}/${id}/download`)).data;

export const removeAttachment = async (company: string, id: string, intent: Intent): Promise<void> => {
  await http.send('DELETE', `${base(company)}/${id}`, undefined, intent);
};
