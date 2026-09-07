/**
 * Assemble the shipped interface skill pack into `dist/`.
 *
 * The repo keeps one copy of the shared `references/`, but a deployed skill has to be
 * self-contained on disk: agents read a skill directory, not a sibling tree, and a
 * project-scoped copy may sit far away from anything else. So the references are
 * materialised into every skill folder here, at build time — which also means the
 * ordinary directory-copy deployment and the ordinary tree hash need no special cases
 * for built-in skills at all.
 */
import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../src/skillpack', import.meta.url));
const out = fileURLToPath(new URL('../dist/skillpack', import.meta.url));
const REFERENCES = 'references';

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const entries = readdirSync(source).filter((name) => statSync(join(source, name)).isDirectory());
const skills = entries.filter((name) => name !== REFERENCES);
const hasReferences = entries.includes(REFERENCES);

for (const skill of skills) {
  cpSync(join(source, skill), join(out, skill), { recursive: true });
  if (hasReferences) {
    // Flattened, not nested: each reference lands beside the SKILL.md that links to it.
    cpSync(join(source, REFERENCES), join(out, skill), { recursive: true });
  }
}

console.log(`skillpack: ${skills.length} skills assembled into dist/skillpack`);
