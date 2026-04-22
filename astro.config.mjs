import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

const siteBase = process.env.GITHUB_PAGES_BASE ?? "/";

export default defineConfig({
  site: "https://growthchartcalculator.com",
  base: siteBase,
  outDir: "dist",
  integrations: [sitemap()],
  build: {
    format: "directory",
  },
});
