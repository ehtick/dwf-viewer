import type { InflateProvider } from './types.js';

type CompressionFormatCompat = 'deflate' | 'deflate-raw' | 'gzip';
type DecompressionStreamCtor = new (format: CompressionFormatCompat) => unknown;

function getDecompressionStreamCtor(): DecompressionStreamCtor | undefined {
  return (globalThis as unknown as { DecompressionStream?: DecompressionStreamCtor }).DecompressionStream;
}

export class BrowserInflateProvider implements InflateProvider {
  async inflateRaw(data: Uint8Array): Promise<Uint8Array> {
    const DS = getDecompressionStreamCtor();
    if (!DS) {
      throw new Error('This browser does not expose DecompressionStream. Provide a custom InflateProvider, or pre-bundle a WASM/JS inflater.');
    }
    try {
      return await decompressWithFormat(data, 'deflate-raw', DS);
    } catch (rawError) {
      try {
        return await decompressWithFormat(data, 'deflate', DS);
      } catch {
        throw rawError instanceof Error ? rawError : new Error(String(rawError));
      }
    }
  }
}

async function decompressWithFormat(data: Uint8Array, format: CompressionFormatCompat, DS: DecompressionStreamCtor): Promise<Uint8Array> {
  const blobStream = (new Blob([data]) as unknown as { stream(): { pipeThrough(transform: unknown): unknown } }).stream();
  const decompressedStream = blobStream.pipeThrough(new DS(format));
  const ab = await new Response(decompressedStream as BodyInit).arrayBuffer();
  return new Uint8Array(ab);
}
