/** Stable metadata only. Binary contents never belong in chat events or cloud snapshots. */
export interface ResourceRef {
  id: string;
  name: string;
  mime: string;
  size: number;
}
export interface Resource extends ResourceRef {
  sha256: string;
  createdAt: number;
  source: "upload" | "directory" | "tool" | "generated";
  state: "ready" | "missing";
  width?: number;
  height?: number;
  duration?: number;
  derivedFrom?: string;
  variant?: "thumbnail" | "poster" | "transcoded";
}
export interface UploadRequest {
  name: string;
  size: number;
  mime?: string;
}
export interface UploadState {
  id: string;
  offset: number;
  size: number;
  chunkSize: number;
  resource?: Resource;
}
export const RESOURCE_MAX_BYTES = 1024 * 1024 * 1024;
export const RESOURCE_CHUNK_BYTES = 1024 * 1024;
export const MESSAGE_MAX_RESOURCES = 10;
export interface ResourceSaveProgress { id: string; received: number; size: number }
export interface ResourceApi {
  begin(input: UploadRequest): Promise<UploadState>;
  status(id: string): Promise<UploadState>;
  append(id: string, offset: number, bytes: Uint8Array): Promise<UploadState>;
  complete(id: string): Promise<Resource>;
  cancel(id: string): Promise<void>;
  get(id: string): Promise<Resource>;
  preview(id: string, thumbnail?: boolean): Promise<string>;
  save(id: string, downloadId: string): Promise<boolean>;
  cancelSave(downloadId: string): Promise<void>;
  onSave(listener: (progress: ResourceSaveProgress) => void): () => void;
}
export function resourceRef(resource: Resource): ResourceRef {
  return { id: resource.id, name: resource.name, mime: resource.mime, size: resource.size };
}
