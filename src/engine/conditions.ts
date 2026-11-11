import type { Operator } from "./types";

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function evaluate(left: unknown, operator: Operator, right: unknown): boolean {
  switch (operator) {
    case "exists":
      return left !== null && left !== undefined && left !== "";
    case "equals":
      return asText(left) === asText(right);
    case "not_equals":
      return asText(left) !== asText(right);
    case "contains":
      return Array.isArray(left)
        ? left.some((item) => asText(item) === asText(right))
        : asText(left).includes(asText(right));
    case "greater_than":
    case "less_than": {
      const a = asNumber(left);
      const b = asNumber(right);
      if (a === null || b === null) return false;
      return operator === "greater_than" ? a > b : a < b;
    }
  }
}
