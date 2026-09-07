/**
 * Every command the shipped skills tell an agent to run must exist.
 *
 * This is the failure mode that matters most for the pack: a skill is instructions an
 * agent follows literally, so a command with a flag or argument the CLI does not accept
 * turns the flagship flow into an error the user never asked for. The spec described
 * `save <ref>`; the CLI rejects the argument outright, and the skill said so for a while
 * because prose was reviewed and the commands were not.
 *
 * Commands are executed against an empty HOME, so most stop at "no store" — which is
 * fine. What is asserted is that the CLI *parsed* them.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));
const PACK = fileURLToPath(new URL('../../dist/skillpack', import.meta.url));

/** Commander's parse failures — the only thing this suite is looking for. */
const PARSE_ERROR = /error: (unknown command|unknown option|too many arguments|missing required)/;

/** Split a shell-ish command line, respecting quotes. Placeholders stay as literals. */
const tokenize = (line: string): string[] => {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (const char of line) {
    if (quote !== null) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ' ') {
      if (current.length > 0) tokens.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
};

/** Every `agent-sync …` line inside a fenced block, with continuations joined. */
const commandsIn = (markdown: string): string[] => {
  const found: string[] = [];
  let fenced = false;
  let pending = '';

  for (const raw of markdown.split('\n')) {
    if (raw.trimStart().startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) continue;

    const line = raw.trim();
    const joined = pending.length > 0 ? `${pending} ${line}` : line;
    if (joined.endsWith('\\')) {
      pending = joined.slice(0, -1).trim();
      continue;
    }
    pending = '';
    if (!joined.startsWith('agent-sync ')) continue;
    // Trailing `# explanation` is documentation, not an argument.
    found.push(joined.replace(/\s+#.*$/, '').trim());
  }
  return found;
};

let home: string;
let prescribed: { file: string; command: string }[];

beforeAll(() => {
  home = join(tmpdir(), `agent-sync-pack-cmds-${process.pid}-${Date.now()}`);
  for (const dir of ['.claude', '.codex', '.cursor'])
    mkdirSync(join(home, dir), { recursive: true });

  prescribed = readdirSync(PACK)
    .filter((name) => statSync(join(PACK, name)).isDirectory())
    .flatMap((skill) =>
      readdirSync(join(PACK, skill))
        .filter((file) => file.endsWith('.md'))
        .flatMap((file) =>
          commandsIn(readFileSync(join(PACK, skill, file), 'utf8')).map((command) => ({
            file: `${skill}/${file}`,
            command,
          })),
        ),
    );
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('the commands the shipped skills prescribe', () => {
  it('finds commands to check', () => {
    // A silent zero here would make every assertion below vacuous.
    expect(prescribed.length).toBeGreaterThan(10);
  });

  it('are all accepted by the CLI', () => {
    const rejected: string[] = [];

    for (const { file, command } of prescribed) {
      const args = tokenize(command).slice(1);
      let output = '';
      try {
        output = execFileSync(process.execPath, [CLI, ...args], {
          cwd: home,
          encoding: 'utf8',
          env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1' },
        });
      } catch (error) {
        const failed = error as { stdout?: string; stderr?: string };
        output = `${failed.stdout ?? ''}${failed.stderr ?? ''}`;
      }
      if (PARSE_ERROR.test(output)) {
        rejected.push(`${file}: ${command}\n    ${output.trim().split('\n')[0]}`);
      }
    }

    expect(rejected, `commands the CLI will not accept:\n  ${rejected.join('\n  ')}`).toEqual([]);
  });
});
