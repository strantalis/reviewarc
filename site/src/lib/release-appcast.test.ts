import { describe, expect, it, vi } from "vitest";
import { renderSparkleAppcast } from "./release-appcast";
import type { SparkleReleaseManifest } from "./release-manifest";
import { NoReleaseError, ReleaseSourceError } from "./release-loader";
import { createAppcastHandler } from "../pages/api/appcast.xml";

const manifestFor = (channel: "stable" | "beta", buildNumber: string): SparkleReleaseManifest => {
  const version = channel === "stable" ? "1.2.3" : "1.3.0-beta.1";
  const fileName = `ReviewArc-${version}-macOS-universal.dmg`;
  return {
    schemaVersion: 1,
    product: "ReviewArc",
    channel,
    version,
    marketingVersion: version.split("-")[0],
    buildNumber,
    publishedAt: "2026-07-13T12:00:00Z",
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

describe("Sparkle appcast", () => {
  it("renders stable on the default channel and beta on the beta channel", () => {
    const xml = renderSparkleAppcast([manifestFor("stable", "42"), manifestFor("beta", "43")]);
    expect(xml).toContain("<sparkle:version>42</sparkle:version>");
    expect(xml).toContain("<sparkle:shortVersionString>1.2.3</sparkle:shortVersionString>");
    expect(xml).toContain("<sparkle:version>43</sparkle:version>");
    expect(xml.match(/<sparkle:channel>beta<\/sparkle:channel>/g)).toHaveLength(1);
    expect(xml).toContain(`sparkle:edSignature="${"A".repeat(86)}=="`);
    expect(xml).toContain('type="application/x-apple-diskimage"');
    expect(xml.indexOf("<sparkle:version>43")).toBeLessThan(xml.indexOf("<sparkle:version>42"));
  });

  it("escapes manifest text before inserting it into XML", () => {
    const manifest = manifestFor("stable", "42");
    manifest.releaseNotesUrl = "https://example.com/releases?one=1&two=2";
    expect(renderSparkleAppcast([manifest])).toContain("one=1&amp;two=2");
  });
});

describe("appcast endpoint", () => {
  it("returns a cacheable signed feed", async () => {
    const handler = createAppcastHandler(vi.fn().mockResolvedValue({
      manifests: [manifestFor("stable", "42")],
      sourceEtag: 'W/"stable:etag:default"',
    }));
    const response = await handler({} as never);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");
    expect(response.headers.get("etag")).toBe('W/"stable:etag:default"');
    expect(await response.text()).toContain("<rss version=\"2.0\"");
  });

  it("returns non-cacheable generic errors", async () => {
    const missing = await createAppcastHandler(vi.fn().mockRejectedValue(new NoReleaseError()))({} as never);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failed = await createAppcastHandler(vi.fn().mockRejectedValue(new ReleaseSourceError("secret")))({} as never);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("secret");
    errorSpy.mockRestore();
  });
});
