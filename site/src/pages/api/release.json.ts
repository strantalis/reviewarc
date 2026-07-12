import type { APIRoute } from "astro";
import { loadPreferredRelease, NoReleaseError } from "../../lib/release-loader";

export const prerender = false;

const successHeaders = {
  "Cache-Control": "public, max-age=0, s-maxage=60",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

const errorHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

type ReleaseLoader = typeof loadPreferredRelease;

export const createReleaseHandler = (loadRelease: ReleaseLoader): APIRoute => async () => {
  try {
    const { manifest, sourceEtag } = await loadRelease();
    return new Response(JSON.stringify(manifest), {
      status: 200,
      headers: { ...successHeaders, ETag: sourceEtag },
    });
  } catch (error) {
    if (!(error instanceof NoReleaseError)) console.error("Release manifest lookup failed", error);
    return new Response(JSON.stringify({ error: "release_unavailable" }), {
      status: error instanceof NoReleaseError ? 404 : 503,
      headers: errorHeaders,
    });
  }
};

export const GET = createReleaseHandler(loadPreferredRelease);
