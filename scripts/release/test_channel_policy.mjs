import assert from "node:assert/strict";
import { createChannelPolicy } from "./channel_policy.mjs";

const timestamp = new Date("2026-07-13T12:00:00Z");
assert.deepEqual(createChannelPolicy("beta", "pause", "bad release", timestamp), {
  schemaVersion: 1,
  channel: "beta",
  paused: true,
  updatedAt: "2026-07-13T12:00:00.000Z",
  reason: "bad release",
});
assert.equal(createChannelPolicy("stable", "resume", "", timestamp).paused, false);
assert.throws(() => createChannelPolicy("nightly", "pause", "", timestamp));
assert.throws(() => createChannelPolicy("stable", "delete", "", timestamp));
assert.throws(() => createChannelPolicy("stable", "pause", "x".repeat(501), timestamp));

console.log("channel policy tests passed");
