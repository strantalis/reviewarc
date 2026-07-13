import { describe, expect, it, vi } from "vitest";
import type { GetBlobResult } from "@vercel/blob";
import { loadAppcastReleases, loadPreferredRelease, NoReleaseError, ReleaseSourceError, type BlobGetter } from "./release-loader";
import { parseReleaseManifest } from "./release-manifest";

const versionFor = (channel: "stable" | "beta") => channel === "stable" ? "1.2.3" : "1.2.3-beta.1";

const manifestFor = (channel: "stable" | "beta") => {
  const version = versionFor(channel);
  const fileName = `ReviewArc-${version}-macOS-universal.dmg`;
  return {
    schemaVersion: 1,
    product: "ReviewArc",
    channel,
    version,
    marketingVersion: "1.2.3",
    buildNumber: "42",
    publishedAt: "2026-07-12T12:00:00Z",
    git: { tag: `v${version}`, commit: "a".repeat(40) },
    macOS: {
      minimumVersion: "13.0",
      architectures: ["arm64", "x86_64"],
      bundleId: "com.silkcitylabs.reviewarc",
      signingTeamId: "UUXB6LG7Q7",
      fileName,
      sizeBytes: 1024,
      sha256: "b".repeat(64),
      sparkle: {
        edSignature: `${"A".repeat(86)}==`,
        contentType: "application/x-apple-diskimage",
      },
      downloadUrl: `https://reviewarc.public.blob.vercel-storage.com/releases/${channel}/v${version}/${fileName}`,
      notarization: { status: "accepted", submissionId: "123e4567-e89b-42d3-a456-426614174000" },
      ticketStapled: true,
    },
    releaseNotesUrl: `https://github.com/strantalis/reviewarc/releases/tag/v${version}`,
  };
};

const blobResult = (body: unknown, overrides: Partial<GetBlobResult> = {}): GetBlobResult => {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    statusCode: 200,
    stream: new Response(text).body!,
    headers: new Headers(),
    blob: {
      url: "https://reviewarc.public.blob.vercel-storage.com/channels/stable/latest.json",
      downloadUrl: "https://reviewarc.public.blob.vercel-storage.com/channels/stable/latest.json?download=1",
      pathname: "channels/stable/latest.json",
      contentDisposition: "inline",
      cacheControl: "public, max-age=60",
      uploadedAt: new Date("2026-07-12T12:00:00Z"),
      etag: "release-etag",
      contentType: "application/json",
      size: new TextEncoder().encode(text).byteLength,
    },
    ...overrides,
  } as GetBlobResult;
};

describe("release manifest validation", () => {
  it("accepts a complete stable release", () => {
    expect(parseReleaseManifest(manifestFor("stable"), "stable").version).toBe("1.2.3");
  });

  it("keeps the download endpoint compatible with manifests published before Sparkle", () => {
    const legacy = manifestFor("stable");
    delete (legacy.macOS as any).sparkle;
    expect(parseReleaseManifest(legacy, "stable").version).toBe("1.2.3");
  });

  it.each([
    ["wrong channel", (value: any) => { value.channel = "beta"; }],
    ["tag mismatch", (value: any) => { value.git.tag = "v9.9.9"; }],
    ["unsafe filename", (value: any) => { value.macOS.fileName = "../ReviewArc.dmg"; }],
    ["noncanonical filename", (value: any) => { value.macOS.fileName = "ReviewArc-extra-1.2.3-macOS-universal.dmg"; }],
    ["invalid numeric prerelease", (value: any) => {
      value.channel = "beta";
      value.version = "1.2.3-01";
      value.git.tag = "v1.2.3-01";
      value.macOS.fileName = "ReviewArc-1.2.3-01-macOS-universal.dmg";
      value.macOS.downloadUrl = "https://reviewarc.public.blob.vercel-storage.com/releases/beta/v1.2.3-01/ReviewArc-1.2.3-01-macOS-universal.dmg";
      value.releaseNotesUrl = "https://github.com/strantalis/reviewarc/releases/tag/v1.2.3-01";
    }],
    ["invalid hash", (value: any) => { value.macOS.sha256 = "nope"; }],
    ["invalid Sparkle signature", (value: any) => { value.macOS.sparkle.edSignature = "nope"; }],
    ["unstapled ticket", (value: any) => { value.macOS.ticketStapled = false; }],
    ["untrusted download", (value: any) => { value.macOS.downloadUrl = "https://example.com/release.dmg"; }],
    ["notes mismatch", (value: any) => { value.releaseNotesUrl = "https://github.com/strantalis/reviewarc/releases/tag/v9.9.9"; }],
    ["extra data", (value: any) => { value.untrusted = true; }],
  ])("rejects %s", (_name, mutate) => {
    const value = structuredClone(manifestFor("stable"));
    mutate(value);
    expect(() => parseReleaseManifest(value, "stable")).toThrow();
  });
});

describe("appcast release loading", () => {
  it("loads active stable and beta releases", async () => {
    const getter = vi.fn<BlobGetter>()
      .mockResolvedValueOnce(blobResult(manifestFor("stable")))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(blobResult(manifestFor("beta")))
      .mockResolvedValueOnce(null);

    const result = await loadAppcastReleases(getter);
    expect(result.manifests.map((manifest) => manifest.channel)).toEqual(["stable", "beta"]);
    expect(getter).toHaveBeenCalledTimes(4);
  });

  it("omits a paused channel", async () => {
    const policy = {
      schemaVersion: 1,
      channel: "stable",
      paused: true,
      updatedAt: "2026-07-13T12:00:00Z",
      reason: "Withdrawn for investigation",
    };
    const getter = vi.fn<BlobGetter>()
      .mockResolvedValueOnce(blobResult(manifestFor("stable")))
      .mockResolvedValueOnce(blobResult(policy))
      .mockResolvedValueOnce(blobResult(manifestFor("beta")))
      .mockResolvedValueOnce(null);

    const result = await loadAppcastReleases(getter);
    expect(result.manifests.map((manifest) => manifest.channel)).toEqual(["beta"]);
  });

  it("fails closed on malformed channel policy", async () => {
    const getter = vi.fn<BlobGetter>()
      .mockResolvedValueOnce(blobResult(manifestFor("stable")))
      .mockResolvedValueOnce(blobResult({ channel: "stable", paused: false }));

    await expect(loadAppcastReleases(getter)).rejects.toBeInstanceOf(ReleaseSourceError);
    expect(getter).toHaveBeenCalledTimes(2);
  });

  it("fails closed when a release is not signed for Sparkle", async () => {
    const unsigned = manifestFor("stable");
    delete (unsigned.macOS as any).sparkle;
    const getter = vi.fn<BlobGetter>().mockResolvedValueOnce(blobResult(unsigned));

    await expect(loadAppcastReleases(getter)).rejects.toBeInstanceOf(ReleaseSourceError);
    expect(getter).toHaveBeenCalledTimes(1);
  });

  it("reports no appcast when every published channel is paused", async () => {
    const paused = (channel: "stable" | "beta") => ({
      schemaVersion: 1,
      channel,
      paused: true,
      updatedAt: "2026-07-13T12:00:00Z",
    });
    const getter = vi.fn<BlobGetter>()
      .mockResolvedValueOnce(blobResult(manifestFor("stable")))
      .mockResolvedValueOnce(blobResult(paused("stable")))
      .mockResolvedValueOnce(blobResult(manifestFor("beta")))
      .mockResolvedValueOnce(blobResult(paused("beta")));

    await expect(loadAppcastReleases(getter)).rejects.toBeInstanceOf(NoReleaseError);
  });
});

describe("preferred release loading", () => {
  it("uses stable without reading beta", async () => {
    const getter = vi.fn<BlobGetter>().mockResolvedValue(blobResult(manifestFor("stable")));
    const result = await loadPreferredRelease(getter);
    expect(result.manifest.channel).toBe("stable");
    expect(getter).toHaveBeenCalledTimes(1);
  });

  it("falls back to beta only when stable is missing", async () => {
    const getter = vi.fn<BlobGetter>().mockResolvedValueOnce(null).mockResolvedValueOnce(blobResult(manifestFor("beta")));
    const result = await loadPreferredRelease(getter);
    expect(result.manifest.channel).toBe("beta");
    expect(getter).toHaveBeenCalledTimes(2);
  });

  it("reports no release when both channels are missing", async () => {
    const getter = vi.fn<BlobGetter>().mockResolvedValue(null);
    await expect(loadPreferredRelease(getter)).rejects.toBeInstanceOf(NoReleaseError);
  });

  it("fails closed on a malformed stable release", async () => {
    const getter = vi.fn<BlobGetter>().mockResolvedValue(blobResult("not json"));
    await expect(loadPreferredRelease(getter)).rejects.toBeInstanceOf(ReleaseSourceError);
    expect(getter).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a stable source contains a beta manifest", async () => {
    const getter = vi.fn<BlobGetter>().mockResolvedValue(blobResult(manifestFor("beta")));
    await expect(loadPreferredRelease(getter)).rejects.toBeInstanceOf(ReleaseSourceError);
    expect(getter).toHaveBeenCalledTimes(1);
  });

  it("rejects non-JSON and oversized responses", async () => {
    const wrongType = blobResult(manifestFor("stable"));
    if (wrongType.statusCode === 200) wrongType.blob.contentType = "text/plain";
    await expect(loadPreferredRelease(vi.fn<BlobGetter>().mockResolvedValue(wrongType))).rejects.toBeInstanceOf(ReleaseSourceError);

    const oversized = blobResult(manifestFor("stable"));
    if (oversized.statusCode === 200) oversized.blob.size = 40_000;
    await expect(loadPreferredRelease(vi.fn<BlobGetter>().mockResolvedValue(oversized))).rejects.toBeInstanceOf(ReleaseSourceError);
  });

  it("does not fall back after a Blob error", async () => {
    const getter = vi.fn<BlobGetter>().mockRejectedValue(new Error("auth failed"));
    await expect(loadPreferredRelease(getter)).rejects.toBeInstanceOf(ReleaseSourceError);
    expect(getter).toHaveBeenCalledTimes(1);
  });

  it("rejects a not-modified response without a usable body", async () => {
    const notModified = {
      statusCode: 304,
      stream: null,
      headers: new Headers(),
      blob: {
        url: "https://reviewarc.public.blob.vercel-storage.com/channels/stable/latest.json",
        downloadUrl: "https://reviewarc.public.blob.vercel-storage.com/channels/stable/latest.json?download=1",
        pathname: "channels/stable/latest.json",
        contentDisposition: "inline",
        cacheControl: "public, max-age=60",
        uploadedAt: new Date("2026-07-12T12:00:00Z"),
        etag: "release-etag",
        contentType: null,
        size: null,
      },
    } satisfies GetBlobResult;
    await expect(loadPreferredRelease(vi.fn<BlobGetter>().mockResolvedValue(notModified))).rejects.toBeInstanceOf(ReleaseSourceError);
  });
});
