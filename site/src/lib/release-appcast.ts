import type { SparkleReleaseManifest } from "./release-manifest";

const appcastTitle = "ReviewArc updates";
const appcastLink = "https://www.reviewarc.dev";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderItem(manifest: SparkleReleaseManifest): string {
  const channel = manifest.channel === "beta"
    ? `\n      <sparkle:channel>beta</sparkle:channel>`
    : "";

  return `    <item>
      <title>${escapeXml(`ReviewArc ${manifest.version}`)}</title>${channel}
      <sparkle:version>${escapeXml(manifest.buildNumber)}</sparkle:version>
      <sparkle:shortVersionString>${escapeXml(manifest.version)}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>${escapeXml(manifest.macOS.minimumVersion)}</sparkle:minimumSystemVersion>
      <pubDate>${escapeXml(new Date(manifest.publishedAt).toUTCString())}</pubDate>
      <sparkle:releaseNotesLink>${escapeXml(manifest.releaseNotesUrl)}</sparkle:releaseNotesLink>
      <enclosure url="${escapeXml(manifest.macOS.downloadUrl)}" sparkle:edSignature="${escapeXml(manifest.macOS.sparkle.edSignature)}" length="${manifest.macOS.sizeBytes}" type="${manifest.macOS.sparkle.contentType}" />
    </item>`;
}

export function renderSparkleAppcast(manifests: SparkleReleaseManifest[]): string {
  const items = [...manifests]
    .sort((left, right) => {
      const leftBuild = BigInt(left.buildNumber);
      const rightBuild = BigInt(right.buildNumber);
      return rightBuild > leftBuild ? 1 : rightBuild < leftBuild ? -1 : 0;
    })
    .map(renderItem)
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>${appcastTitle}</title>
    <link>${appcastLink}</link>
    <description>Signed ReviewArc application updates</description>
${items}
  </channel>
</rss>
`;
}
