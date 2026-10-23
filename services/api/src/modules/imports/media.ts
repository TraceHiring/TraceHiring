// RED stub (tests first): replaced by the implementation.
export interface ItemMediaStore {
  head(key: string): Promise<{ size: number; contentType: string | null } | null>;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}
