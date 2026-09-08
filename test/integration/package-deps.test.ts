/**
 * Everything the published code imports is a declared runtime dependency.
 *
 * `smol-toml` was a devDependency while `dist/adapters/mcp.js` imported it, so the
 * published package installed without it and the CLI died on its first command with a
 * module-not-found trace. Nothing caught it: the tests run from a tree where dev
 * dependencies are present, the build succeeds, and the tarball looks complete. The
 * failure only exists for someone who installs it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIST = join(ROOT, 'dist');

const jsUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return jsUnder(path);
    return name.endsWith('.js') ? [path] : [];
  });

/** What npm accepts as a package name — anything else is not an import specifier. */
const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/** Bare specifiers only: relative paths and node: builtins need no declaration. */
const importsIn = (file: string): string[] => {
  const text = readFileSync(file, 'utf8');
  const found = new Set<string>();
  for (const match of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    const specifier = match[1] ?? '';
    if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;

    // A package may be imported by a subpath, so keep only the package part.
    const parts = specifier.split('/');
    const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? '');

    // The word "import" also appears inside ordinary string literals — `emitJson('import',
    // …)` for one — and the pattern above cannot tell those apart. A real specifier is
    // always a legal package name, so requiring that is both the filter and the check.
    if (PACKAGE_NAME.test(name)) found.add(name);
  }
  return [...found];
};

describe('the published package declares what it imports', () => {
  it('has every runtime import in dependencies, not devDependencies', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = new Set(Object.keys(manifest.dependencies ?? {}));
    const dev = new Set(Object.keys(manifest.devDependencies ?? {}));

    const used = [...new Set(jsUnder(DIST).flatMap(importsIn))].sort();
    expect(used.length).toBeGreaterThan(0);

    const missing = used.filter((name) => !declared.has(name));
    expect(
      missing,
      `imported by dist/ but not a runtime dependency: ${missing
        .map((name) => (dev.has(name) ? `${name} (it is a devDependency)` : name))
        .join(', ')}`,
    ).toEqual([]);
  });
});
