const TAG = /\{\{\s*([^{}]+?)\s*\}\}/g;
const WHOLE = /^\{\{\s*([^{}]+?)\s*\}\}$/;
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);

export function lookup(source: unknown, path: string): unknown {
  let current = source;
  for (const key of path.split(".")) {
    if (current === null || current === undefined || FORBIDDEN.has(key)) return undefined;
    if (typeof current !== "object") return undefined;
    if (!Object.hasOwn(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function render(template: string, context: unknown): string {
  return template.replace(TAG, (_match, path: string) => asText(lookup(context, path)));
}

export function resolve(template: string, context: unknown): unknown {
  const whole = WHOLE.exec(template.trim());
  if (whole) return lookup(context, whole[1]) ?? null;
  return render(template, context);
}

export function references(template: string): string[] {
  return [...template.matchAll(TAG)].map((match) => match[1]);
}
