export const SOCIAL_IMAGE_PATH = "/images/og/reviewarc-og.jpg?v=2";
export const SOCIAL_IMAGE_ALT =
  "ReviewArc review brief showing an insufficient-evidence recommendation and findings awaiting human judgment.";

interface SocialMetadataInput {
  canonical?: URL | null;
  description: string;
  site: URL;
  title: string;
  type?: "article" | "website";
}

export const socialMetadata = ({
  canonical,
  description,
  site,
  title,
  type = "website",
}: SocialMetadataInput) => {
  const image = new URL(SOCIAL_IMAGE_PATH, site).href;

  return {
    openGraph: {
      description,
      image,
      imageAlt: SOCIAL_IMAGE_ALT,
      imageHeight: "630",
      imageType: "image/jpeg",
      imageWidth: "1200",
      siteName: "ReviewArc",
      title,
      type,
      url: canonical?.href,
    },
    twitter: {
      card: "summary_large_image",
      description,
      image,
      imageAlt: SOCIAL_IMAGE_ALT,
      title,
    },
  };
};
