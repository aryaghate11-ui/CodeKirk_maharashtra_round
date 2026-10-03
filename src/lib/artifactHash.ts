const MAX_LOCAL_HASH_BYTES = 100 * 1024 * 1024;

export async function sha256File(file: File): Promise<string> {
  if (file.size > MAX_LOCAL_HASH_BYTES) {
    throw new Error('Choose a file smaller than 100 MB for this browser-based verifier.');
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error('This browser does not support secure local SHA-256 hashing.');
  }

  const bytes = await file.arrayBuffer();
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
