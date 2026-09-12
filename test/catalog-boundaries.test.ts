import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validateThemeCatalog } from "../src/catalog/index.js";
import { emitNavigationHelpers } from "../src/catalog/templates/navigation.js";
import { emitMiddleware } from "../src/catalog/templates/middleware.js";
const spec = () => JSON.parse(readFileSync(new URL("../examples/loom-black-catalog.json", import.meta.url), "utf8"));
const helpers = new Function(emitNavigationHelpers().replaceAll("export function", "function") + "\nreturn {safeHref,localHref,projectNavigation};")();
describe("closed catalog navigation", () => {
  it.each(["//host/path", "/%252e%252e/private", "/%250aheader", "/%255cfile", "javascript:alert(1)", "/a/../b"])("rejects %s at both boundaries", href => {
    const input=spec();input.catalog.hero.routes[0].actions[0].href=href;
    expect(()=>validateThemeCatalog(input)).toThrow();
    expect(()=>helpers.safeHref(href)).toThrow();
  });
  it("adds consumer base only to catalog navigation", () => {
    expect(helpers.localHref("/guide/", "/docs/")).toBe("/docs/guide/");
    expect(helpers.localHref("#local", "/docs/")).toBe("#local");
  });
  it("projects public navigation without arbitrary attrs or discovery", () => {
    const result=helpers.projectNavigation([{type:"group",label:"Group",collapsed:true,autogenerate:{directory:"not-read"},entries:[{type:"link",label:"Page",href:"/docs/page/",isCurrent:true,attrs:{title:"Tip","aria-label":"Page label",onclick:"forbidden","data-private":"ignored"}}]}]);
    expect(result[0].current).toBe(true);
    expect(result[0].entries[0]).toMatchObject({href:"/docs/page/",title:"Tip",ariaLabel:"Page label",current:true});
    expect(JSON.stringify(result)).not.toContain("forbidden");
    expect(JSON.stringify(result)).not.toContain("not-read");
  });
  it("rejects excess nesting and node count", () => {
    let entry:any={type:"link",label:"Page",href:"/",isCurrent:false};
    for(let i=0;i<10;i++) entry={type:"group",label:"Group",entries:[entry],collapsed:true};
    expect(()=>helpers.projectNavigation([entry])).toThrow();
    expect(()=>helpers.projectNavigation(Array.from({length:513},()=>({type:"link",label:"Page",href:"/",isCurrent:false})))).toThrow();
  });
  it("selects by public route ID and preserves consumer Hero", async () => {
    const input=spec();const selected=input.catalog.hero.routes[0];
    const code=emitMiddleware(input.catalog.hero.routes).replace(/^import data[^\n]+\n/,`const data=${JSON.stringify({hero:input.catalog.hero})};\n`).replace("export async function","async function");
    const onRequest=new Function(code+"\nreturn onRequest;")();
    const route={id:selected.route.replace(/^\//,""),entry:{data:{}}};
    const context:any={locals:{starlightRoute:route},url:new URL("https://fixture.invalid/base"+selected.route)};
    await onRequest(context,()=>Promise.resolve("done"));
    expect(context.locals.tfslCatalogHero.title).toBe(selected.title);
    const hero={title:"Consumer hero"};const consumer:any={locals:{starlightRoute:{id:route.id,entry:{data:{hero}}}}};
    await onRequest(consumer,()=>Promise.resolve("done"));
    expect(consumer.locals.starlightRoute.entry.data.hero).toBe(hero);
    expect(consumer.locals.tfslCatalogHero).toBeUndefined();
  });
});
