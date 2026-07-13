import { get, put } from "@vercel/blob";
import { createChannelPolicy } from "./channel_policy.mjs";

const [channel, action, reason = ""] = process.argv.slice(2);
const policy = createChannelPolicy(channel, action, reason);
const pathname = `channels/${channel}/policy.json`;
const existing = await get(pathname, { access: "public", useCache: false });
if (existing && existing.statusCode !== 200) {
  throw new Error(`Unexpected existing channel policy response: ${existing.statusCode}`);
}

const options = {
  access: "public",
  addRandomSuffix: false,
  allowOverwrite: Boolean(existing),
  cacheControlMaxAge: 60,
  contentType: "application/json",
};
if (existing?.blob.etag) options.ifMatch = existing.blob.etag;

const result = await put(pathname, `${JSON.stringify(policy, null, 2)}\n`, options);
process.stdout.write(`${JSON.stringify({ policyUrl: result.url, ...policy })}\n`);
