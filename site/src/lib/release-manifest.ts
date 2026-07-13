import { z } from "zod";

const prereleaseIdentifier = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const semverPattern = new RegExp(`^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(${prereleaseIdentifier}(?:\\.${prereleaseIdentifier})*))?$`);
const sha256Pattern = /^[a-f0-9]{64}$/;
const ed25519SignaturePattern = /^[A-Za-z0-9+/]{86}==$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeFilenamePattern = /^ReviewArc-[0-9A-Za-z.-]+-macOS-universal\.dmg$/;

const releaseManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  product: z.literal("ReviewArc"),
  channel: z.enum(["beta", "stable"]),
  version: z.string().regex(semverPattern),
  marketingVersion: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  buildNumber: z.string().regex(/^[1-9]\d*$/).max(18),
  publishedAt: z.iso.datetime({ offset: true }),
  git: z.strictObject({
    tag: z.string(),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
  }),
  macOS: z.strictObject({
    minimumVersion: z.string().regex(/^\d+(?:\.\d+){1,2}$/),
    architectures: z.tuple([z.literal("arm64"), z.literal("x86_64")]),
    bundleId: z.literal("com.silkcitylabs.reviewarc"),
    signingTeamId: z.string().regex(/^[A-Z0-9]{10}$/),
    fileName: z.string().regex(safeFilenamePattern).max(160),
    sizeBytes: z.number().int().positive().max(2_147_483_648),
    sha256: z.string().regex(sha256Pattern),
    sparkle: z.strictObject({
      edSignature: z.string().regex(ed25519SignaturePattern),
      contentType: z.literal("application/x-apple-diskimage"),
    }).optional(),
    downloadUrl: z.url({ protocol: /^https$/ }),
    notarization: z.strictObject({
      status: z.literal("accepted"),
      submissionId: z.string().regex(uuidPattern),
    }),
    ticketStapled: z.literal(true),
  }),
  releaseNotesUrl: z.url({ protocol: /^https$/ }),
}).superRefine((manifest, context) => {
  const prerelease = manifest.version.includes("-");
  if ((manifest.channel === "beta") !== prerelease) {
    context.addIssue({ code: "custom", message: "Release channel does not match version", path: ["channel"] });
  }
  if (manifest.marketingVersion !== manifest.version.split("-", 1)[0]) {
    context.addIssue({ code: "custom", message: "Marketing version does not match version", path: ["marketingVersion"] });
  }
  if (manifest.git.tag !== `v${manifest.version}`) {
    context.addIssue({ code: "custom", message: "Git tag does not match version", path: ["git", "tag"] });
  }
  if (manifest.macOS.fileName !== `ReviewArc-${manifest.version}-macOS-universal.dmg`) {
    context.addIssue({ code: "custom", message: "Artifact filename does not match version", path: ["macOS", "fileName"] });
  }

  const releasePath = `/releases/${manifest.channel}/v${manifest.version}/${manifest.macOS.fileName}`;
  try {
    const download = new URL(manifest.macOS.downloadUrl);
    if (!download.hostname.endsWith(".public.blob.vercel-storage.com") || download.pathname !== releasePath) {
      context.addIssue({ code: "custom", message: "Artifact URL is outside the release namespace", path: ["macOS", "downloadUrl"] });
    }
  } catch {
    // The URL schema issue is already reported by Zod.
  }

  const expectedNotes = `https://github.com/strantalis/reviewarc/releases/tag/v${manifest.version}`;
  if (manifest.releaseNotesUrl !== expectedNotes) {
    context.addIssue({ code: "custom", message: "Release notes URL does not match version", path: ["releaseNotesUrl"] });
  }
});

export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;
export type SparkleReleaseManifest = ReleaseManifest & {
  macOS: ReleaseManifest["macOS"] & { sparkle: NonNullable<ReleaseManifest["macOS"]["sparkle"]> };
};

export function parseReleaseManifest(value: unknown, expectedChannel: ReleaseManifest["channel"]): ReleaseManifest {
  const manifest = releaseManifestSchema.parse(value);
  if (manifest.channel !== expectedChannel) {
    throw new Error("Release manifest channel does not match its source");
  }
  return manifest;
}
