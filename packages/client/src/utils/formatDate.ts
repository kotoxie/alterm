/**
 * Parse a date string safely as UTC.
 * SQLite stores datetimes as "YYYY-MM-DD HH:MM:SS" (no timezone marker).
 * JS/browsers treat space-separated date-time strings as LOCAL time, not UTC.
 * We normalise to "YYYY-MM-DDTHH:MM:SSZ" so Date always parses as UTC.
 */
function toUTCDate(dateStr: string): Date {
  // Already has a timezone marker (ISO 8601 with Z or ±offset)
  if (dateStr.includes('Z') || /[+-]\d{2}:\d{2}$/.test(dateStr)) {
    return new Date(dateStr);
  }
  // SQLite space-separated → ISO UTC
  return new Date(dateStr.replace(' ', 'T') + 'Z');
}

export function formatDate(dateStr: string | null | undefined, timezone?: string): string {
  if (!dateStr) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'UTC',
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(toUTCDate(dateStr));
  } catch {
    return dateStr;
  }
}

export function formatRelative(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const diff = Date.now() - toUTCDate(dateStr).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
