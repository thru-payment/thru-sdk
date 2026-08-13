export function shorten(value: string, head = 6, tail = 4): string {
  if (!value) return '';
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export type StatusTone = 'neutral' | 'pending' | 'success' | 'danger';

export function statusTone(status: string): StatusTone {
  const s = (status ?? '').toLowerCase();
  if (['confirmed', 'settled', 'active', 'succeeded', 'paid', 'completed'].includes(s)) return 'success';
  if (['failed', 'expired', 'underpaid', 'refunded', 'cancelled', 'canceled', 'disabled'].includes(s)) return 'danger';
  if (['detected', 'confirming', 'waiting_for_payment', 'pending', 'processing', 'overpaid'].includes(s)) return 'pending';
  return 'neutral';
}

export function statusLabel(status: string): string {
  return (status ?? '').replaceAll('_', ' ');
}

/** Human duration from seconds, e.g. 2592000 -> "30 days". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0';
  const units: [number, string][] = [
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
    [1, 'second'],
  ];
  for (const [size, name] of units) {
    if (seconds % size === 0) {
      const n = seconds / size;
      return `${n} ${name}${n === 1 ? '' : 's'}`;
    }
  }
  const days = Math.round(seconds / 86400);
  return `${days} day${days === 1 ? '' : 's'}`;
}
