import { get, type GetBlobResult, type GetCommandOptions } from "@vercel/blob";
import { parseReleaseManifest, releaseChannelForVersion, type ReleaseManifest, type SparkleReleaseManifest } from "./release-manifest";

const MAX_MANIFEST_BYTES = 32 * 1024;
const MAX_POLICY_BYTES = 4 * 1024;
type Channel = ReleaseManifest["channel"];
export type BlobGetter = (pathname: string, options: GetCommandOptions) => Promise<GetBlobResult | null>;

export class NoReleaseError extends Error {}
export class ReleaseSourceError extends Error {}

async function readStream(stream: ReadableStream<Uint8Array>, maxBytes = MAX_MANIFEST_BYTES): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new ReleaseSourceError("Release metadata exceeds size limit");
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
  return readReleaseManifest(`channels/${channel}/latest.json`, channel, getBlob);
}

async function readReleaseManifest(pathname: string, channel: Channel, getBlob: BlobGetter): Promise<{ manifest: ReleaseManifest; sourceEtag: string } | null> {
  let result: GetBlobResult | null;
  try {
    result = await getBlob(pathname, {
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

async function isChannelPaused(channel: Channel, getBlob: BlobGetter): Promise<{ paused: boolean; sourceEtag: string | null }> {
  let result: GetBlobResult | null;
  try {
    result = await getBlob(`channels/${channel}/policy.json`, {
      access: "public",
      useCache: false,
      abortSignal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    throw new ReleaseSourceError(`Unable to read ${channel} release policy`, { cause: error });
  }

  if (result === null) return { paused: false, sourceEtag: null };
  if (result.statusCode !== 200 || result.stream === null) {
    throw new ReleaseSourceError(`Unexpected ${channel} release policy response`);
  }
  if (result.blob.size > MAX_POLICY_BYTES) {
    throw new ReleaseSourceError(`${channel} release policy exceeds size limit`);
  }
  if (!result.blob.contentType.toLowerCase().startsWith("application/json")) {
    throw new ReleaseSourceError(`${channel} release policy is not JSON`);
  }

  try {
    const value = JSON.parse(await readStream(result.stream, MAX_POLICY_BYTES));
    const keys = value && typeof value === "object" ? Object.keys(value).sort() : [];
    const allowedKeys = value?.reason === undefined
      ? ["channel", "paused", "schemaVersion", "updatedAt"]
      : ["channel", "paused", "reason", "schemaVersion", "updatedAt"];
    if (
      keys.join("\0") !== allowedKeys.sort().join("\0") ||
      value.schemaVersion !== 1 ||
      value.channel !== channel ||
      typeof value.paused !== "boolean" ||
      typeof value.updatedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.updatedAt) ||
      !Number.isFinite(Date.parse(value.updatedAt)) ||
      (value.reason !== undefined && (typeof value.reason !== "string" || value.reason.length > 500))
    ) {
      throw new Error("Invalid release policy");
    }
    return { paused: value.paused, sourceEtag: result.blob.etag };
  } catch (error) {
    if (error instanceof ReleaseSourceError) throw error;
    throw new ReleaseSourceError(`Invalid ${channel} release policy`, { cause: error });
  }
}

export async function loadPreferredRelease(getBlob: BlobGetter = get): Promise<{ manifest: ReleaseManifest; sourceEtag: string }> {
  const stable = await readChannel("stable", getBlob);
  if (stable) return stable;
  const beta = await readChannel("beta", getBlob);
  if (beta) return beta;
  throw new NoReleaseError("No release manifest is available");
}

export async function loadReleaseVersion(version: string, getBlob: BlobGetter = get): Promise<{ manifest: ReleaseManifest; sourceEtag: string }> {
  const channel = releaseChannelForVersion(version);
  if (!channel) throw new NoReleaseError("Invalid release version");
  const release = await readReleaseManifest(`releases/${channel}/v${version}/manifest.json`, channel, getBlob);
  if (!release) throw new NoReleaseError("Release manifest is not available");
  return release;
}

export async function loadAppcastReleases(getBlob: BlobGetter = get): Promise<{ manifests: SparkleReleaseManifest[]; sourceEtag: string }> {
  const releases: SparkleReleaseManifest[] = [];
  const etags: string[] = [];

  for (const channel of ["stable", "beta"] as const) {
    const release = await readChannel(channel, getBlob);
    if (!release) continue;
    if (!release.manifest.macOS.sparkle) {
      throw new ReleaseSourceError(`${channel} release manifest is not signed for Sparkle`);
    }
    const policy = await isChannelPaused(channel, getBlob);
    etags.push(`${channel}:${release.sourceEtag}:${policy.sourceEtag ?? "default"}`);
    if (!policy.paused) releases.push(release.manifest as SparkleReleaseManifest);
  }

  if (releases.length === 0) throw new NoReleaseError("No active release manifest is available");
  return { manifests: releases, sourceEtag: `W/"${encodeURIComponent(etags.join("|"))}"` };
}
