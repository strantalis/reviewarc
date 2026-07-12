import { describe, expect, it, vi } from "vitest";
import { NoReleaseError, ReleaseSourceError } from "./release-loader";
import { createReleaseHandler } from "../pages/api/release.json";

const manifest = { schemaVersion: 1, product: "ReviewArc", channel: "stable", version: "1.0.0" } as never;

describe("release endpoint", () => {
  it("returns a cacheable validated release", async () => {
    const handler = createReleaseHandler(vi.fn().mockResolvedValue({ manifest, sourceEtag: "etag-1" }));
    const response = await handler({} as never);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60");
    expect(response.headers.get("etag")).toBe("etag-1");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual(manifest);
  });

  it("returns a generic non-cacheable 404 when no release exists", async () => {
    const handler = createReleaseHandler(vi.fn().mockRejectedValue(new NoReleaseError()));
    const response = await handler({} as never);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "release_unavailable" });
  });

  it("returns a generic non-cacheable 503 for source failures", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = createReleaseHandler(vi.fn().mockRejectedValue(new ReleaseSourceError("private detail")));
    const response = await handler({} as never);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("private detail");
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });
});
