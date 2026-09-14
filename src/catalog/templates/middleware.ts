import type { HeroRoute } from "../types.js";
export function emitMiddleware(_routes: HeroRoute[]): string {
  return `import data from "./catalog-data.json" with { type: "json" };
export async function onRequest(context, next) {
  const route = context.locals.starlightRoute;
  if (!route?.entry?.data || route.entry.data.hero) return next();
  if (typeof route.id !== "string") throw new Error("Missing public Starlight route ID");
  const normalize = value => "/" + value.replace(/^\\/+|\\/+$/g, "");
  const selected = data.hero.routes.find(r => normalize(r.route) === normalize(route.id));
  if (selected) {
    route.entry.data.hero = { title: selected.title, tagline: selected.subtitle || selected.summary, actions: [] };
    context.locals.tfslCatalogHero = selected;
  }
  return next();
}
`;
}
