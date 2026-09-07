/**
 * Detecting that an agent already has the same server under a different name.
 *
 * Adopting a server on one machine and syncing it to another leaves two entries where
 * the second machine had configured the same server by hand: agent-sync writes its own
 * id, and correctly refuses to touch the one it does not manage. Nothing is lost, but
 * silence makes it look like nothing happened — so the condition is reported.
 *
 * Identity is what the entry actually *connects to*, not how it is spelled: two entries
 * are the same server when they reach the same URL, or run the same command with the
 * same arguments. Names, descriptions and agent-specific fields are deliberately
 * ignored, since those are exactly what differs between a hand-added entry and ours.
 */

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;

/** What an entry connects to, or `null` when that cannot be determined. */
export const connectionIdentity = (entry: unknown): string | null => {
  const record = asRecord(entry);
  if (record === null) return null;

  if (typeof record.url === 'string' && record.url.trim().length > 0) {
    return `url:${record.url.trim()}`;
  }
  if (typeof record.command === 'string' && record.command.trim().length > 0) {
    const args = Array.isArray(record.args) ? record.args.map((arg) => String(arg)).join(' ') : '';
    return `cmd:${record.command.trim()} ${args}`.trim();
  }
  return null;
};

/**
 * Ids at one location, other than the managed one, that reach the same server.
 *
 * Sorted so the message is stable between runs — an unstable order would make the
 * diagnostic look like it was changing when it was not.
 */
export const duplicatesOf = (
  managed: unknown,
  managedId: string,
  entries: Readonly<Record<string, unknown>>,
): readonly string[] => {
  const identity = connectionIdentity(managed);
  if (identity === null) return [];

  return Object.entries(entries)
    .filter(([id, entry]) => id !== managedId && connectionIdentity(entry) === identity)
    .map(([id]) => id)
    .sort();
};
