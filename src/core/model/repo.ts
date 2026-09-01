/**
 * Parsing for the repository name accepted by `init --create-remote`.
 *
 * The point of the flag is that a name is all the user should have to think about, so
 * this is deliberately forgiving about *shape* (`name` or `owner/name`) and strict
 * about *characters* — a name the forge would reject should fail here, with an
 * explanation, rather than halfway through creating a repository.
 */
import { err, ok, type Result } from '../result.js';

/** GitHub accepts letters, digits, hyphen, underscore and period in a repository name. */
const REPO_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Owner logins are alphanumeric with interior hyphens, at most 39 characters. */
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

const MAX_NAME_LENGTH = 100;

export interface RepoName {
  /** `null` means "the authenticated user" — resolved at the edge, not here. */
  readonly owner: string | null;
  readonly name: string;
}

export type RepoNameError =
  | { readonly kind: 'empty' }
  | { readonly kind: 'looks-like-url'; readonly value: string }
  | { readonly kind: 'too-many-segments'; readonly value: string }
  | { readonly kind: 'invalid-name'; readonly value: string }
  | { readonly kind: 'invalid-owner'; readonly value: string }
  | { readonly kind: 'too-long'; readonly value: string };

/** A git URL rather than a name — worth its own message, since --remote takes those. */
const looksLikeUrl = (raw: string): boolean =>
  /^[a-z+]+:\/\//i.test(raw) || raw.includes('@') || raw.endsWith('.git');

/**
 * Parse `name` or `owner/name`.
 *
 * `.` and `..` are rejected explicitly: both match the character class but neither can
 * be a directory the store is cloned into.
 */
export const parseRepoName = (raw: string): Result<RepoName, RepoNameError> => {
  const input = raw.trim();
  if (input.length === 0) return err({ kind: 'empty' });
  if (looksLikeUrl(input)) return err({ kind: 'looks-like-url', value: input });

  // Split on the first slash rather than into segments: it mirrors parseArtifactRef,
  // and it leaves no unreachable "missing segment" branch to explain away.
  const slash = input.indexOf('/');
  const rawOwner = slash === -1 ? null : input.slice(0, slash);
  const rawName = slash === -1 ? input : input.slice(slash + 1);

  if (rawName.includes('/')) return err({ kind: 'too-many-segments', value: input });
  if (rawOwner !== null && !OWNER_PATTERN.test(rawOwner)) {
    return err({ kind: 'invalid-owner', value: rawOwner });
  }
  if (rawName.length === 0) return err({ kind: 'empty' });
  if (rawName.length > MAX_NAME_LENGTH) return err({ kind: 'too-long', value: rawName });
  if (rawName === '.' || rawName === '..' || !REPO_NAME_PATTERN.test(rawName)) {
    return err({ kind: 'invalid-name', value: rawName });
  }

  return ok({ owner: rawOwner, name: rawName });
};

/** Full `owner/name` slug, once the owner is known. */
export const repoSlug = (repo: RepoName, fallbackOwner: string): string =>
  `${repo.owner ?? fallbackOwner}/${repo.name}`;

/** Human-readable explanation of a rejected name. */
export const describeRepoNameError = (error: RepoNameError): string => {
  switch (error.kind) {
    case 'empty':
      return 'a repository name is required, for example: --create-remote agent-library';
    case 'looks-like-url':
      return (
        `"${error.value}" is a git URL, not a repository name.\n` +
        '  --create-remote takes a name and makes the repository for you: --create-remote agent-library\n' +
        '  to point at a repository that already exists, use --remote instead'
      );
    case 'too-many-segments':
      return `"${error.value}" has too many parts — use "name" or "owner/name"`;
    case 'invalid-owner':
      return `"${error.value}" is not a valid owner — letters, digits and interior hyphens only`;
    case 'too-long':
      return `"${error.value}" is longer than ${MAX_NAME_LENGTH} characters`;
    case 'invalid-name':
      return `"${error.value}" is not a valid repository name — letters, digits, - _ and . only`;
  }
};
