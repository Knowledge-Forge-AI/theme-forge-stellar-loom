/** Fixed public-route projection; no route files, arbitrary attrs or module lookup. */
export function emitNavigationHelpers(): string {
  return `export function safeHref(value) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Invalid navigation href");
  let decoded = value;
  for (let i=0; i<4; i++) { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; }
  if (!decoded || !["/", "#"].includes(decoded[0]) || decoded.startsWith("//") || /[\\\\\\u0000-\\u0020\\u007f]/.test(decoded) || decoded.includes("%") || decoded.split(/[/?#]/).some(p => p === "." || p === "..")) throw new Error("Invalid navigation href");
  return value;
}
export function localHref(value, base) {
  safeHref(value);
  return value.startsWith("#") ? value : (base || "/").replace(/\\/+$/, "") + value;
}
export function text(value) {
  if (typeof value !== "string" || !value || value.length > 256 || /[\\u0000-\\u001f\\u007f]/.test(value)) throw new Error("Invalid navigation label");
  return value;
}
export function projectNavigation(entries) {
  let count=0;
  function walk(items, depth) {
    if (!Array.isArray(items) || depth > 8) throw new Error("Navigation depth exceeded");
    return items.map(item => {
      if (++count > 512 || !item || !["link","group"].includes(item.type)) throw new Error("Invalid navigation entry");
      const label=text(item.label);
      if (item.type === "group") {
        const entries=walk(item.entries,depth+1);
        return {type:"group", label, entries, current:entries.some(e=>e.current), collapsed:item.collapsed === true};
      }
      return {type:"link",label,href:safeHref(item.href),current:item.isCurrent === true,
        title:item.attrs?.title === undefined ? undefined : text(item.attrs.title),
        ariaLabel:item.attrs?.["aria-label"] === undefined ? undefined : text(item.attrs["aria-label"])};
    });
  }
  return walk(entries,0);
}
`;
}
