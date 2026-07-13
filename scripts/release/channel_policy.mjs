const channels = new Set(["stable", "beta"]);
const actions = new Set(["pause", "resume"]);

export function createChannelPolicy(channel, action, reason = "", now = new Date()) {
  if (!channels.has(channel)) throw new Error("Channel must be stable or beta");
  if (!actions.has(action)) throw new Error("Action must be pause or resume");
  if (typeof reason !== "string" || reason.length > 500) throw new Error("Reason must not exceed 500 characters");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Policy timestamp is invalid");

  const policy = {
    schemaVersion: 1,
    channel,
    paused: action === "pause",
    updatedAt: now.toISOString(),
  };
  if (reason) policy.reason = reason;
  return policy;
}
