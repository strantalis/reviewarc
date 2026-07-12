import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { get, put } from "@vercel/blob";

const [dmgPath, manifestPath] = process.argv.slice(2);
if (!dmgPath || !manifestPath) throw new Error("DMG and manifest paths are required");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
  throw new Error("Refusing to publish an invalid release version");
}

const channel = manifest.channel;
if (channel !== "beta" && channel !== "stable") throw new Error("Invalid release channel");
const immutablePrefix = `releases/${channel}/v${manifest.version}`;
const artifactPath = `${immutablePrefix}/${basename(dmgPath)}`;

async function readBlob(pathname, collect = false) {
  const result = await get(pathname, { access: "public", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  const hash = createHash("sha256");
  const chunks = [];
  let size = 0;
  for await (const chunk of result.stream) {
    size += chunk.length;
    hash.update(chunk);
    if (collect) chunks.push(Buffer.from(chunk));
  }
  return {
    ...result.blob,
    size,
    sha256: hash.digest("hex"),
    text: collect ? Buffer.concat(chunks).toString("utf8") : null,
  };
}

async function verifyArtifact(existing) {
  if (!existing || existing.size !== manifest.macOS.sizeBytes || existing.sha256 !== manifest.macOS.sha256) {
    throw new Error("Existing immutable DMG does not match this notarized release");
  }
  if (!existing.downloadUrl?.startsWith("https://")) throw new Error("Blob download URL is not secure");
  return existing;
}

let artifact = await readBlob(artifactPath);
if (!artifact) {
  try {
    await put(artifactPath, createReadStream(dmgPath), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 31_536_000,
      contentType: "application/x-apple-diskimage",
      multipart: true,
    });
  } catch (error) {
    artifact = await readBlob(artifactPath);
    if (!artifact) throw error;
  }
  artifact = artifact ?? await readBlob(artifactPath);
}
artifact = await verifyArtifact(artifact);

manifest.macOS.downloadUrl = artifact.downloadUrl;
let manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
const immutableManifestPath = `${immutablePrefix}/manifest.json`;

function verifyManifest(existingText) {
  const existing = JSON.parse(existingText);
  const matches =
    existing.schemaVersion === manifest.schemaVersion &&
    existing.version === manifest.version &&
    existing.git?.commit === manifest.git?.commit &&
    existing.macOS?.sha256 === manifest.macOS.sha256 &&
    existing.macOS?.sizeBytes === manifest.macOS.sizeBytes &&
    existing.macOS?.bundleId === manifest.macOS.bundleId &&
    existing.macOS?.downloadUrl === manifest.macOS.downloadUrl;
  if (!matches) throw new Error("Existing immutable manifest does not match this release");
  return existingText.endsWith("\n") ? existingText : `${existingText}\n`;
}

let existingManifest = await readBlob(immutableManifestPath, true);
if (existingManifest) {
  manifestText = verifyManifest(existingManifest.text);
} else {
  try {
    await put(immutableManifestPath, manifestText, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 31_536_000,
      contentType: "application/json",
    });
  } catch (error) {
    existingManifest = await readBlob(immutableManifestPath, true);
    if (!existingManifest) throw error;
    manifestText = verifyManifest(existingManifest.text);
  }
}

await writeFile(manifestPath, manifestText);
process.stdout.write(`${JSON.stringify({ artifactUrl: artifact.downloadUrl, version: manifest.version })}\n`);
