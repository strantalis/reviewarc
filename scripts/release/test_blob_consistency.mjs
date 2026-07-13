import assert from "node:assert/strict";
import { waitForMatchingArtifact } from "./blob_consistency.mjs";

const expected = { size: 42, sha256: "expected" };

let reads = 0;
const immediate = await waitForMatchingArtifact({
  pathname: "release.dmg",
  initialArtifact: expected,
  expectedSize: expected.size,
  expectedSha256: expected.sha256,
  readArtifact: async () => {
    reads += 1;
    return expected;
  },
  retryDelaysMs: [1],
  pause: async () => {},
});
assert.equal(immediate, expected);
assert.equal(reads, 0);

const delays = [];
reads = 0;
const eventual = await waitForMatchingArtifact({
  pathname: "release.dmg",
  initialArtifact: { size: 42, sha256: "stale" },
  expectedSize: expected.size,
  expectedSha256: expected.sha256,
  readArtifact: async () => {
    reads += 1;
    return reads === 2 ? expected : null;
  },
  retryDelaysMs: [1, 2],
  pause: async (milliseconds) => delays.push(milliseconds),
});
assert.equal(eventual, expected);
assert.deepEqual(delays, [1, 2]);

await assert.rejects(
  waitForMatchingArtifact({
    pathname: "release.dmg",
    initialArtifact: null,
    expectedSize: expected.size,
    expectedSha256: expected.sha256,
    readArtifact: async () => null,
    retryDelaysMs: [1, 2],
    pause: async () => {},
  }),
  /Existing immutable DMG does not match this notarized release/,
);

console.log("blob consistency tests passed");
