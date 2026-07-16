import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import vercel from "@astrojs/vercel";

const isDev = process.argv.includes("dev");

export default defineConfig({
  site: "https://www.reviewarc.dev",
  output: "static",
  devToolbar: { enabled: false },
  markdown: { syntaxHighlight: "prism" },
  adapter: vercel({ staticHeaders: true }),
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "base-uri 'none'",
        "connect-src 'self'",
        "font-src 'self'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "img-src 'self' data:",
        "object-src 'none'"
      ],
      // Starlight emits three inline bootstraps outside Astro's automatic hash
      // collection; the fourth hash is src/components/ThemeBootstrap.astro.
      scriptDirective: {
        hashes: [
          "sha256-VWo5Wp4aqSj6nSgMpeAp9cKieaoIfwFUAunAVugI5gA=",
          "sha256-f/zAUE74ucc3JYp4r4QQvkJofoQdkOIhHYK+jeZ6eko=",
          "sha256-GkZBRnvSuhtx/cvzvukVkX2JJZW+DdPlVr7BX8Tefqo=",
          "sha256-0zxizHhQLZjHe2H7CJG/7oRnpRAAnOpd31G96KN8O20="
        ]
      },
      styleDirective: {
        resources: [
          "'self'",
          ...(isDev ? ["'unsafe-inline'"] : [])
        ]
      }
    }
  },
  integrations: [
    starlight({
      title: "ReviewArc docs",
      description: "Evidence-backed pull request review.",
      favicon: "/favicon.svg",
      logo: {
        src: "./src/assets/reviewarc-mark.svg"
      },
      customCss: ["./src/styles/fonts.css", "./src/styles/starlight.css"],
      head: [
        { tag: "meta", attrs: { property: "og:image", content: "https://www.reviewarc.dev/images/og/reviewarc-og.png" } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        { tag: "meta", attrs: { name: "twitter:image", content: "https://www.reviewarc.dev/images/og/reviewarc-og.png" } },
        { tag: "link", attrs: { rel: "preload", href: "/fonts/commissioner-latin.woff2", as: "font", type: "font/woff2", crossorigin: "anonymous" } },
        { tag: "link", attrs: { rel: "preload", href: "/fonts/spline-sans-mono-latin.woff2", as: "font", type: "font/woff2", crossorigin: "anonymous" } }
      ],
      lastUpdated: true,
      sidebar: [
        {
          label: "ReviewArc",
          items: [
            { label: "Product home", link: "/" },
            { label: "Download ReviewArc", link: "/#download" }
          ]
        },
        {
          label: "Start here",
          items: [
            { label: "Overview", slug: "docs" },
            { label: "Getting started", slug: "docs/getting-started" },
            { label: "Inbox and sources", slug: "docs/inbox-and-sources" }
          ]
        },
        {
          label: "Review workflow",
          items: [
            { label: "Analysis and re-analysis", slug: "docs/analysis-and-reanalysis" },
            { label: "Guided review", slug: "docs/guided-review" },
            { label: "Publishing reviews", slug: "docs/publishing-reviews" }
          ]
        },
        {
          label: "Trust and support",
          items: [
            { label: "Security and local data", slug: "docs/security-and-local-data" }
          ]
        }
      ]
    })
  ]
});
