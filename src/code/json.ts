/** Compare decoded JSON keys, including equivalent Unicode escape spellings. */
export function assertUniqueJsonKeys(text: string): void {
  if (Buffer.byteLength(text, "utf8") > 16 * 1024 * 1024) throw new Error("JSON byte limit exceeded");
  const objects: Set<string>[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") objects.push(new Set());
    else if (text[i] === "}") objects.pop();
    else if (text[i] === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") i++;
        i++;
      }
      const token = text.slice(start, i + 1);
      let next = i + 1;
      while (/\s/.test(text[next] ?? "") && next < text.length) next++;
      if (text[next] !== ":") continue;
      const key: string = JSON.parse(token);
      const scope = objects.at(-1);
      if (scope?.has(key)) throw new Error(`Duplicate key '${key}' in JSON`);
      scope?.add(key);
    }
  }
}
