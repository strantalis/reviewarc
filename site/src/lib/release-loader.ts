import { get, type GetBlobResult, type GetCommandOptions } from "@vercel/blob";
import { parseReleaseManifest, type ReleaseManifest } from "./release-manifest";

const MAX_MANIFEST_BYTES = 32 * 1024;
type Channel = ReleaseManifest["channel"];
export type BlobGetter = (pathname: string, options: GetCommandOptions) => Promise<GetBlobResult | null>;

export class NoReleaseError extends Error {}
export class ReleaseSourceError extends Error {}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MANIFEST_BYTES) throw new ReleaseSourceError("Release manifest exceeds size limit");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

async function readChannel(channel: Channel, getBlob: BlobGetter): Promise<{ manifest: ReleaseManifest; sourceEtag: string } | null> {
  let result: GetBlobResult | null;
  try {
    result = await getBlob(`channels/${channel}/latest.json`, {
      access: "public",
      useCache: false,
      abortSignal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    throw new ReleaseSourceError(`Unable to read ${channel} release manifest`, { cause: error });
  }

  if (result === null) return null;
  if (result.statusCode !== 200 || result.stream === null) {
    throw new ReleaseSourceError(`Unexpected ${channel} release response`);
  }
  if (result.blob.size > MAX_MANIFEST_BYTES) {
    throw new ReleaseSourceError(`${channel} release manifest exceeds size limit`);
  }
  if (!result.blob.contentType.toLowerCase().startsWith("application/json")) {
    throw new ReleaseSourceError(`${channel} release manifest is not JSON`);
  }

  try {
    const text = await readStream(result.stream);
    return { manifest: parseReleaseManifest(JSON.parse(text), channel), sourceEtag: result.blob.etag };
  } catch (error) {
    if (error instanceof ReleaseSourceError) throw error;
    throw new ReleaseSourceError(`Invalid ${channel} release manifest`, { cause: error });
  }
}

export async function loadPreferredRelease(getBlob: BlobGetter = get): Promise<{ manifest: ReleaseManifest; sourceEtag: string }> {
  const stable = await readChannel("stable", getBlob);
  if (stable) return stable;
  const beta = await readChannel("beta", getBlob);
  if (beta) return beta;
  throw new NoReleaseError("No release manifest is available");
}
