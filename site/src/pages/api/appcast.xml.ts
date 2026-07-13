import type { APIRoute } from "astro";
import { renderSparkleAppcast } from "../../lib/release-appcast";
import { loadAppcastReleases, NoReleaseError } from "../../lib/release-loader";

export const prerender = false;

type AppcastLoader = typeof loadAppcastReleases;

export const createAppcastHandler = (loadReleases: AppcastLoader): APIRoute => async () => {
  try {
    const { manifests, sourceEtag } = await loadReleases();
    return new Response(renderSparkleAppcast(manifests), {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=60",
        "Content-Type": "application/rss+xml; charset=utf-8",
        ETag: sourceEtag,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (!(error instanceof NoReleaseError)) console.error("Appcast lookup failed", error);
    return new Response("Update feed unavailable\n", {
      status: error instanceof NoReleaseError ? 404 : 503,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
};

export const GET = createAppcastHandler(loadAppcastReleases);
