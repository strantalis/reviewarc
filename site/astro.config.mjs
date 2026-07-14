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
        "font-src 'self' https://fonts.gstatic.com",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "img-src 'self' data:",
        "object-src 'none'"
      ],
      // Starlight emits three inline bootstraps outside Astro's automatic hash collection.
      scriptDirective: {
        hashes: [
          "sha256-VWo5Wp4aqSj6nSgMpeAp9cKieaoIfwFUAunAVugI5gA=",
          "sha256-f/zAUE74ucc3JYp4r4QQvkJofoQdkOIhHYK+jeZ6eko=",
          "sha256-GkZBRnvSuhtx/cvzvukVkX2JJZW+DdPlVr7BX8Tefqo="
        ]
      },
      styleDirective: {
        resources: [
          "'self'",
          "https://fonts.googleapis.com",
          ...(isDev ? ["'unsafe-inline'"] : [])
        ]
      }
    }
  },
  integrations: [
    starlight({
      title: "ReviewArc docs",
      description: "Evidence-backed pull request review for macOS.",
      favicon: "/favicon.svg",
      logo: {
        src: "./src/assets/reviewarc-mark.svg"
      },
      customCss: ["./src/styles/starlight.css"],
      head: [
        { tag: "link", attrs: { rel: "preconnect", href: "https://fonts.googleapis.com" } },
        { tag: "link", attrs: { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "anonymous" } },
        { tag: "link", attrs: { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Commissioner:wght@400;500;600;650;700&display=swap" } }
      ],
      lastUpdated: true,
      sidebar: [
        {
          label: "ReviewArc",
          items: [
            { label: "Product home", link: "/" },
            { label: "Download for macOS", link: "/#download" }
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
