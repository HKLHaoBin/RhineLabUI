import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

function pagesBase(): string {
  const value = process.env.BASE_PATH;
  if (!value || value === "/") return "/";
  const withLeading = value.startsWith("/") ? value : `/${value}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

function prefixPublicAssetUrls(base: string): Plugin {
  return {
    name: "prefix-public-asset-urls",
    transform(code, id) {
      if (base === "/") return;
      const file = id.split("?")[0].replaceAll("\\", "/");
      if (!file.endsWith("/src/style.css")) return;
      return code.replaceAll('url("/', `url("${base}`);
    },
  };
}

function writeNoJekyll(): Plugin {
  return {
    name: "write-nojekyll",
    closeBundle() {
      writeFileSync(resolve(import.meta.dirname, "dist/.nojekyll"), "");
    },
  };
}

export default defineConfig({
  base: pagesBase(),
  plugins: [prefixPublicAssetUrls(pagesBase()), writeNoJekyll()],
});
