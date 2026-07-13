import { appendFile, readFile } from "node:fs/promises";
import { get, head, put } from "@vercel/blob";
import { compareVersions } from "./semver.mjs";

const [manifestPath] = process.argv.slice(2);
if (!manifestPath) throw new Error("Manifest path is required");

const manifestText = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestText);
if (
  manifest.schemaVersion !== 1 ||
  !manifest.macOS?.downloadUrl?.startsWith("https://") ||
  !/^[A-Za-z0-9+/]{86}==$/.test(manifest.macOS?.sparkle?.edSignature ?? "") ||
  manifest.macOS?.sparkle?.contentType !== "application/x-apple-diskimage"
) {
  throw new Error("Refusing to promote an incomplete release manifest");
}
if (manifest.channel !== "beta" && manifest.channel !== "stable") {
  throw new Error("Refusing to promote an invalid release channel");
}

const latestPath = `channels/${manifest.channel}/latest.json`;
const currentResult = await get(latestPath, { access: "public", useCache: false });
let current = null;
let currentText = null;
let currentMetadata = null;
if (currentResult?.statusCode === 200) {
  const chunks = [];
  for await (const chunk of currentResult.stream) chunks.push(Buffer.from(chunk));
  currentText = Buffer.concat(chunks).toString("utf8");
  current = JSON.parse(currentText);
  // Public get() responses may be served by the CDN. Conditional writes must
  // use the current origin ETag returned by the Blob metadata API.
  currentMetadata = await head(latestPath);
  if (!currentMetadata.etag) throw new Error("Current channel manifest has no origin ETag");
}

let promoted = true;
let latestUrl = currentMetadata?.url ?? currentResult?.blob.url ?? null;
if (current) {
  const comparison = compareVersions(manifest.version, current.version);
  if (comparison < 0) {
    promoted = false;
  } else if (comparison === 0) {
    if (manifest.macOS.sha256 !== current.macOS?.sha256) {
      throw new Error("Current channel manifest has the same version but different release bytes");
    }
  } else {
    const latest = await put(latestPath, manifestText, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      ifMatch: currentMetadata.etag,
      cacheControlMaxAge: 60,
      contentType: "application/json",
    });
    latestUrl = latest.url;
  }
} else {
  const latest = await put(latestPath, manifestText, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 60,
    contentType: "application/json",
  });
  latestUrl = latest.url;
}

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `promoted=${promoted}\n`);
}

process.stdout.write(`${JSON.stringify({ manifestUrl: latestUrl, promoted, version: manifest.version })}\n`);
