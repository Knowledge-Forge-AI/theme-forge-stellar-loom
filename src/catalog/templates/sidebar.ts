import type { ThemeCatalogConfig } from "../types.js";
export function emitSidebarTree(): string {
  return `---
const {entries} = Astro.props;
---
<ul class="tfsl-nav-tree">
  {entries.map((item: any) => <li>
    {item.type === "group" ? <details open={item.current || !item.collapsed}>
      <summary>{item.label}</summary><Astro.self entries={item.entries} />
    </details> : <a href={item.href} aria-current={item.current ? "page" : undefined} title={item.title} aria-label={item.ariaLabel}>{item.label}</a>}
  </li>)}
</ul>
<style>
  ul { list-style:none; margin:0; padding:0; }
  ul ul { padding-inline-start:1rem; }
  a,summary { display:block; padding:.4rem .6rem; color:var(--sl-color-text); border-radius:var(--tfsl-radius-small); overflow-wrap:anywhere; }
  a[aria-current="page"] { color:var(--sl-color-accent-high); background:var(--sl-color-accent-low); }
  summary { cursor:pointer; }
</style>
`;
}
export function emitSidebarComponent(_catalog: ThemeCatalogConfig): string {
  return `---
import MobileMenuFooter from "@astrojs/starlight/components/MobileMenuFooter.astro";
import Tree from "./SidebarTree.astro";
import data from "../catalog-data.json";
import { projectNavigation } from "../navigation.js";
const mode = data.sidebar.mode;
const entries = projectNavigation(Astro.locals.starlightRoute.sidebar);
const ids = data.sidebar.groupIds;
if (mode !== "nested" && (entries.length !== ids.length || entries.some(e => e.type !== "group"))) throw new Error("Catalog sidebar group binding mismatch");
if (entries.length > 16) throw new Error("Catalog sidebar group limit exceeded");
const active = entries.flatMap((e,i) => e.current ? [i] : []);
if (mode !== "nested" && active.length > 1) throw new Error("Ambiguous active sidebar group");
const selected = active[0] ?? 0;
const groups = entries.map((entry,i)=>({entry,id:ids[i] || String(i),active:i===selected}));
---
<nav class="tfsl-sidebar-container" data-tfsl-sidebar-mode={mode} aria-label="Documentation navigation">
  {mode === "nested" ? <Tree entries={entries} /> : <>
    {mode === "tabs" && <div role="tablist" class="tfsl-roving-tablist" aria-label="Documentation sections">
      {groups.map(g=><button type="button" role="tab" id={\`tfsl-nav-tab-\${g.id}\`} aria-controls={\`tfsl-nav-panel-\${g.id}\`} aria-selected={g.active ? "true":"false"} tabindex={g.active?0:-1}>{g.entry.label}</button>)}
    </div>}
    {mode === "select" && <><label for="tfsl-sidebar-dropdown">Documentation section</label><select id="tfsl-sidebar-dropdown" class="tfsl-sidebar-select">
      {groups.map(g=><option value={g.id} selected={g.active}>{g.entry.label}</option>)}
    </select></>}
    {groups.map(g=><div id={\`tfsl-nav-panel-\${g.id}\`} class:list={["tfsl-sidebar-panel", {"tfsl-tab-panel":mode==="tabs", "tfsl-select-panel":mode==="select"}]} data-group-id={g.id} role={mode==="tabs"?"tabpanel":undefined} aria-labelledby={mode==="tabs"?\`tfsl-nav-tab-\${g.id}\`:undefined} hidden={!g.active}>
      {mode === "active-only" && <p>{g.entry.label}</p>}
      <Tree entries={g.entry.entries} />
    </div>)}
  </>}
  <div class="md:sl-hidden"><MobileMenuFooter /></div>
</nav>
<script>
  for (const root of document.querySelectorAll<HTMLElement>("[data-tfsl-sidebar-mode]")) {
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const panels = [...root.querySelectorAll<HTMLElement>(".tfsl-sidebar-panel")];
    function activate(index: number, focus: boolean) {
      tabs.forEach((tab,i)=>{tab.setAttribute("aria-selected",String(i===index));tab.tabIndex=i===index?0:-1;});
      panels.forEach((panel,i)=>{panel.hidden=i!==index;});
      if(focus) tabs[index]?.focus();
    }
    tabs.forEach((tab,index)=>{
      tab.addEventListener("click",()=>activate(index,true));
      tab.addEventListener("keydown",event=>{
        const rtl=getComputedStyle(root).direction==="rtl";
        const forward=event.key===(rtl?"ArrowLeft":"ArrowRight");
        const backward=event.key===(rtl?"ArrowRight":"ArrowLeft");
        const target=event.key==="Home"?0:event.key==="End"?tabs.length-1:forward?(index+1)%tabs.length:backward?(index-1+tabs.length)%tabs.length:-1;
        if(target>=0){event.preventDefault();activate(target,true);}
      });
    });
    root.querySelector<HTMLSelectElement>("select")?.addEventListener("change",event=>activate((event.target as HTMLSelectElement).selectedIndex,false));
  }
</script>
<style>
  .tfsl-sidebar-container { padding:.5rem; min-width:0; }
  .tfsl-roving-tablist { display:flex; flex-wrap:wrap; gap:.25rem; margin-bottom:1rem; }
  button,select { min-width:0; max-width:100%; padding:.5rem; color:var(--sl-color-text); background:var(--tfsl-color-panel); border:1px solid var(--tfsl-color-border); border-radius:var(--tfsl-radius-small); }
  button[aria-selected="true"] { color:var(--sl-color-accent-high); background:var(--sl-color-accent-low); }
  select { width:100%; }
  [hidden] { display:none; }
</style>
`;
}
