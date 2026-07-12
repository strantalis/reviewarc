import { appendFile, readFile } from "node:fs/promises";
import { get, put } from "@vercel/blob";
import { compareVersions } from "./semver.mjs";

const [manifestPath] = process.argv.slice(2);
if (!manifestPath) throw new Error("Manifest path is required");

const manifestText = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestText);
if (manifest.schemaVersion !== 1 || !manifest.macOS?.downloadUrl?.startsWith("https://")) {
  throw new Error("Refusing to promote an incomplete release manifest");
}
if (manifest.channel !== "beta" && manifest.channel !== "stable") {
  throw new Error("Refusing to promote an invalid release channel");
}

const latestPath = `channels/${manifest.channel}/latest.json`;
const currentResult = await get(latestPath, { access: "public", useCache: false });
let current = null;
let currentText = null;
if (currentResult?.statusCode === 200) {
  const chunks = [];
  for await (const chunk of currentResult.stream) chunks.push(Buffer.from(chunk));
  currentText = Buffer.concat(chunks).toString("utf8");
  current = JSON.parse(currentText);
}

let promoted = true;
let latestUrl = currentResult?.blob.url ?? null;
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
      ifMatch: currentResult.blob.etag,
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
