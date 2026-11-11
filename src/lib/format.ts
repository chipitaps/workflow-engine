export function duration(ms: number) {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${Math.round(seconds % 60)} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function relativeTime(date: Date, now: Date = new Date()) {
  const diff = date.getTime() - now.getTime();
  const seconds = Math.round(Math.abs(diff) / 1000);
  const phrase = (text: string) => (diff > 0 ? `in ${text}` : `${text} ago`);
  if (seconds < 5) return "just now";
  if (seconds < 60) return phrase(`${seconds} s`);
  if (seconds < 3600) return phrase(`${Math.round(seconds / 60)} min`);
  if (seconds < 86400) return phrase(`${Math.round(seconds / 3600)} h`);
  return phrase(`${Math.round(seconds / 86400)} d`);
}

export function everyLabel(minutes: number) {
  if (minutes % 1440 === 0) return minutes === 1440 ? "every day" : `every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "every hour" : `every ${minutes / 60} hours`;
  return minutes === 1 ? "every minute" : `every ${minutes} minutes`;
}
