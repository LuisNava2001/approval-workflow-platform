// Money is handled as integer cents end to end; decimal strings only at the API boundary.

const DECIMAL = /^\d{1,7}(\.\d{1,2})?$/;

export function parseMoneyToCents(raw: unknown): number | null {
  if (typeof raw !== "string" || !DECIMAL.test(raw.trim())) return null;
  const [whole = "0", fraction = ""] = raw.trim().split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100).toLocaleString("en-US")}.${String(absolute % 100).padStart(2, "0")}`;
}
