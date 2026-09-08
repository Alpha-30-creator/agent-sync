/**
 * Every relative link in the project's markdown resolves.
 *
 * This repository is about to be public, and its docs cross-reference heavily — the
 * design set alone carries roughly eighty relative links between siblings. Moving a file
 * silently breaks them, and nothing else notices: a broken link in a spec is invisible
 * until a reader hits it.
 *
 * The shipped skill pack is checked in its *built* form on purpose. Its shared reference
 * is materialised into each skill folder at build time, so `troubleshoot.md` resolves
 * beside the SKILL.md that links to it in `dist/` and in every deployed copy — but never
 * in `src/`, where one copy is shared. Checking the built pack proves the materialisation
 * works, which is the thing that actually matters to an agent reading the skill.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SKIP = new Set(['node_modules', '.git', 'coverage', 'skillpack']);

const markdownUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (SKIP.has(name)) return [];
    if (statSync(path).isDirectory()) return markdownUnder(path);
    return name.endsWith('.md') ? [path] : [];
  });

const brokenLinksIn = (file: string): string[] => {
  const text = readFileSync(file, 'utf8');
  const broken: string[] = [];
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const raw = match[1] ?? '';
    const target = raw.split('#')[0]?.trim() ?? '';
    // External links and pure anchors are somebody else's problem.
    if (target.length === 0 || /^[a-z]+:/i.test(target) || raw.startsWith('#')) continue;
    if (!existsSync(resolve(dirname(file), target))) broken.push(`${file} → ${raw}`);
  }
  return broken;
};

describe('markdown cross-references', () => {
  it('resolve everywhere in the repository', () => {
    const files = markdownUnder(ROOT).filter((file) => !file.includes(`${ROOT}dist`));
    expect(files.length).toBeGreaterThan(10);

    const broken = files.flatMap(brokenLinksIn);
    expect(broken, `broken links:\n  ${broken.join('\n  ')}`).toEqual([]);
  });

  it('resolve in the built skill pack, where the shared reference is materialised', () => {
    const pack = join(ROOT, 'dist', 'skillpack');
    const broken = markdownUnder(pack).flatMap(brokenLinksIn);
    expect(broken, `broken links:\n  ${broken.join('\n  ')}`).toEqual([]);
  });
});
