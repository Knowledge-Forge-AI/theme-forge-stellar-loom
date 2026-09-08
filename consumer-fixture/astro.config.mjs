import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

const scenario = process.env.CONSUMER_SCENARIO || "cyan";
const outDir = process.env.ASTRO_OUT_DIR || "./dist";
const explicitPackageName = process.env.THEME_PACKAGE_NAME;
const plugins = [];
const components = {};
const packages = {
  cyan: "starlight-theme-stellar-cyan",
  amber: "starlight-theme-amber-forge",
  "consumer-override": "starlight-theme-amber-forge",
  nova: explicitPackageName,
  "nova-override": explicitPackageName,
};
if (scenario !== "disconnected" && scenario !== "nova-disconnected") {
  const packageName = packages[scenario];
  if (!packageName) throw new Error("Unknown consumer scenario or missing explicit theme package name");
  const { default: themePlugin } = await import(packageName);
  plugins.push(themePlugin());
  if (scenario === "consumer-override" || scenario === "nova-override") {
    components.PageTitle = "./src/components/ConsumerPageTitle.astro";
  }
}

export default defineConfig({
  outDir,
  integrations: [
    starlight({
      title: "Consumer Documentation",
      plugins,
      components,
      customCss: ["./src/styles/consumer-custom.css"],
      sidebar: [
        {
          label: "Guides",
          items: [{ label: "Overview", slug: "index" }],
        },
      ],
    }),
  ],
});
