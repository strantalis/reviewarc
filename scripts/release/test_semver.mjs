import assert from "node:assert/strict";
import { compareVersions } from "./semver.mjs";

assert.equal(compareVersions("0.1.0-beta.1", "0.1.0-beta.1"), 0);
assert.equal(compareVersions("0.1.0-beta.2", "0.1.0-beta.1"), 1);
assert.equal(compareVersions("0.1.0", "0.1.0-beta.9"), 1);
assert.equal(compareVersions("0.2.0-beta.1", "0.1.9"), 1);
assert.equal(compareVersions("1.0.0-alpha", "1.0.0-alpha.1"), -1);
assert.equal(compareVersions("1.0.0-alpha.1", "1.0.0-alpha.beta"), -1);
assert.throws(() => compareVersions("01.0.0", "1.0.0"));
console.log("semantic version tests passed");
