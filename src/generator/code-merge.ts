/** Merge only theme-owned branches; preserve opaque consumer values without execution. */
export function deepCloneSafe<T>(val: T): T {
  if (Array.isArray(val)) return val.map(deepCloneSafe) as T;
  if (val === null || typeof val !== "object") return val;
  const result: Record<PropertyKey, any> = {};
  for (const key of Object.keys(val)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) continue;
    Object.defineProperty(result, key, { value: deepCloneSafe((val as any)[key]), enumerable: true, writable: true, configurable: true });
  }
  return result as T;
}
export function mergeCodeConfig(defaults: any, consumer: any): any {
  if (consumer === false) return false;
  if (consumer === undefined || consumer === true) return deepCloneSafe(defaults);
  if (consumer === null || typeof consumer !== "object" || Array.isArray(consumer)) return consumer;
  const proto = Object.getPrototypeOf(consumer);
  if (proto !== Object.prototype && proto !== null) return consumer;
  if (defaults === null || typeof defaults !== "object" || Array.isArray(defaults)) return consumer;
  const result = deepCloneSafe(defaults);
  for (const key of Reflect.ownKeys(consumer)) {
    if (typeof key === "string" && ["__proto__", "prototype", "constructor"].includes(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(consumer, key);
    if (!descriptor) continue;
    if (!("value" in descriptor)) { Object.defineProperty(result, key, descriptor); continue; }
    const value = descriptor.value;
    if (value === undefined) continue;
    const themeValue = Object.hasOwn(defaults, key) ? defaults[key] : undefined;
    const branch = themeValue !== null && typeof themeValue === "object" && !Array.isArray(themeValue);
    const merged = branch && value !== true ? mergeCodeConfig(themeValue, value) : value;
    Object.defineProperty(result, key, { ...descriptor, value: merged });
  }
  return result;
}

export const CODE_MERGE_HELPER_STRING = "function deepCloneSafe(val) {\n  if (Array.isArray(val)) return val.map(deepCloneSafe);\n  if (val === null || typeof val !== \"object\") return val;\n  const result = {};\n  for (const key of Object.keys(val)) {\n    if ([\"__proto__\", \"prototype\", \"constructor\"].includes(key)) continue;\n    Object.defineProperty(result, key, { value: deepCloneSafe(val[key]), enumerable: true, writable: true, configurable: true });\n  }\n  return result;\n}\nfunction mergeCodeConfig(defaults, consumer) {\n  if (consumer === false) return false;\n  if (consumer === undefined || consumer === true) return deepCloneSafe(defaults);\n  if (consumer === null || typeof consumer !== \"object\" || Array.isArray(consumer)) return consumer;\n  const proto = Object.getPrototypeOf(consumer);\n  if (proto !== Object.prototype && proto !== null) return consumer;\n  if (defaults === null || typeof defaults !== \"object\" || Array.isArray(defaults)) return consumer;\n  const result = deepCloneSafe(defaults);\n  for (const key of Reflect.ownKeys(consumer)) {\n    if (typeof key === \"string\" && [\"__proto__\", \"prototype\", \"constructor\"].includes(key)) continue;\n    const descriptor = Object.getOwnPropertyDescriptor(consumer, key);\n    if (!descriptor) continue;\n    if (!(\"value\" in descriptor)) { Object.defineProperty(result, key, descriptor); continue; }\n    const value = descriptor.value;\n    if (value === undefined) continue;\n    const themeValue = Object.hasOwn(defaults, key) ? defaults[key] : undefined;\n    const branch = themeValue !== null && typeof themeValue === \"object\" && !Array.isArray(themeValue);\n    const merged = branch && value !== true ? mergeCodeConfig(themeValue, value) : value;\n    Object.defineProperty(result, key, { ...descriptor, value: merged });\n  }\n  return result;\n}\n";
export const MERGE_HELPER_STRING = CODE_MERGE_HELPER_STRING;
export const MERGE_HELPER_EXPRESSION = CODE_MERGE_HELPER_STRING;
export const emitMergeHelper = () => CODE_MERGE_HELPER_STRING;
export const mergeExpressiveCode = mergeCodeConfig;
export const mergeExpressiveCodeConfig = mergeCodeConfig;
export const mergeCodeDefaults = mergeCodeConfig;
