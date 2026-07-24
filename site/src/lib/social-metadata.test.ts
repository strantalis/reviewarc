import { describe, expect, it } from "vitest";
import { SOCIAL_IMAGE_ALT, socialMetadata } from "./social-metadata";

describe("socialMetadata", () => {
  it("builds complete Open Graph and X card metadata with a versioned image URL", () => {
    const metadata = socialMetadata({
      canonical: new URL("https://www.reviewarc.dev/releases/"),
      description: "Release notes for ReviewArc.",
      site: new URL("https://www.reviewarc.dev"),
      title: "ReviewArc releases",
    });

    expect(metadata.openGraph).toEqual({
      description: "Release notes for ReviewArc.",
      image: "https://www.reviewarc.dev/images/og/reviewarc-og.jpg?v=2",
      imageAlt: SOCIAL_IMAGE_ALT,
      imageHeight: "630",
      imageType: "image/jpeg",
      imageWidth: "1200",
      siteName: "ReviewArc",
      title: "ReviewArc releases",
      type: "website",
      url: "https://www.reviewarc.dev/releases/",
    });
    expect(metadata.twitter).toEqual({
      card: "summary_large_image",
      description: "Release notes for ReviewArc.",
      image: "https://www.reviewarc.dev/images/og/reviewarc-og.jpg?v=2",
      imageAlt: SOCIAL_IMAGE_ALT,
      title: "ReviewArc releases",
    });
  });

  it("supports article cards without a canonical URL", () => {
    const metadata = socialMetadata({
      description: "Release details.",
      site: new URL("https://www.reviewarc.dev"),
      title: "ReviewArc release unavailable",
      type: "article",
    });

    expect(metadata.openGraph.type).toBe("article");
    expect(metadata.openGraph.url).toBeUndefined();
  });
});
