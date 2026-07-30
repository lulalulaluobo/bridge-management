export function todayInShanghai(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function statusForExpiration(expiresAt: string, today = todayInShanghai()): "expired" | "expiring" | "normal" {
  if (expiresAt < today) return "expired";
  if (expiresAt <= addDays(today, 3)) return "expiring";
  return "normal";
}
