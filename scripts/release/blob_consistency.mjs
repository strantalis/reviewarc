const defaultRetryDelaysMs = Object.freeze([1_000, 2_000, 4_000, 8_000, 16_000, 30_000]);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function waitForMatchingArtifact({
  pathname,
  initialArtifact,
  expectedSize,
  expectedSha256,
  readArtifact,
  retryDelaysMs = defaultRetryDelaysMs,
  pause = sleep,
}) {
  let artifact = initialArtifact;
  for (let attempt = 0; ; attempt += 1) {
    if (artifact?.size === expectedSize && artifact.sha256 === expectedSha256) {
      return artifact;
    }
    if (attempt === retryDelaysMs.length) {
      throw new Error("Existing immutable DMG does not match this notarized release");
    }
    await pause(retryDelaysMs[attempt]);
    artifact = await readArtifact(pathname);
  }
}
