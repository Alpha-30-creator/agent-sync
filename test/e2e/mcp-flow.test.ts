/**
 * End-to-end: MCP servers across all three agents, plus onboarding by import.
 *
 * The properties that matter here are about trust: credentials never reach the
 * git-backed library, and configuration the user owns is edited surgically or not at
 * all.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseJsonc } from 'jsonc-parser';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));
const CODEX_FIXTURE = readFileSync(
  new URL('../fixtures/codex-config.toml', import.meta.url),
  'utf8',
);

const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

let workspace: string;
let home: string;

const run = (args: readonly string[], input?: string) => {
  try {
    return {
      code: 0,
      stdout: execFileSync(process.execPath, [CLI, ...args], {
        cwd: home,
        encoding: 'utf8',
        ...(input === undefined ? {} : { input }),
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          GIT_AUTHOR_NAME: 'test',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'test',
          GIT_COMMITTER_EMAIL: 'test@example.com',
          NO_COLOR: '1',
        },
      }),
    };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failed.status ?? 1, stdout: `${failed.stdout ?? ''}${failed.stderr ?? ''}` };
  }
};

// These files may legitimately contain comments — that is precisely what agent-sync
// has to preserve — so they are read with a JSONC parser, not JSON.parse.
const readJson = (path: string): Record<string, never> =>
  parseJsonc(readFileSync(path, 'utf8')) as Record<string, never>;

/**
 * Search the whole library for a string, in Node rather than via grep: the point of
 * this suite is that it behaves identically on Windows, and shelling out to grep does
 * not.
 */
const storeContains = (needle: string): boolean => {
  const walk = (dir: string): boolean => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git') continue;
        if (walk(path)) return true;
        continue;
      }
      if (readFileSync(path, 'utf8').includes(needle)) return true;
    }
    return false;
  };
  return walk(join(home, '.agent-sync', 'store'));
};

beforeAll(() => {
  workspace = join(tmpdir(), `agent-sync-mcp-e2e-${process.pid}-${Date.now()}`);
  home = join(workspace, 'home');
  for (const dir of ['.claude', '.codex', '.cursor'])
    mkdirSync(join(home, dir), { recursive: true });

  // A machine that already has configuration, as every real one does.
  writeFileSync(join(home, '.codex', 'config.toml'), CODEX_FIXTURE);
  writeFileSync(
    join(home, '.cursor', 'mcp.json'),
    '{\n  // set up by hand\n  "mcpServers": {\n    "existing": { "command": "node" }\n  }\n}\n',
  );
  writeFileSync(
    join(home, '.claude.json'),
    JSON.stringify(
      {
        numStartups: 42,
        mcpServers: {
          legacy: { command: 'npx', args: ['-y', 'legacy'], env: { LEGACY_TOKEN: TOKEN } },
        },
      },
      null,
      2,
    ),
  );

  run(['init', '--device', 'mac']);
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('adding an MCP server once and getting it everywhere', () => {
  it('refuses to put a literal credential into the library', () => {
    const result = run(['add', 'mcp', 'bad', '--command', 'npx', '--env', `GITHUB_TOKEN=${TOKEN}`]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('looks like a credential');
    expect(result.stdout).toContain('agent-sync secret set');
  });

  it('accepts a secret reference and says which secret is missing', () => {
    const result = run([
      'add',
      'mcp',
      'github',
      '--command',
      'npx',
      '--args',
      '-y',
      '@modelcontextprotocol/server-github',
      '--env',
      'GITHUB_TOKEN=${secret:github-token}',
    ]);
    // The CLI's own output is attached to the assertion, so a platform-specific
    // failure explains itself in CI rather than only showing an exit code.
    expect(result.code, result.stdout).toBe(2); // converged with a warning
    expect(result.stdout).toContain('secret set github-token');
  });

  it('takes the secret value from stdin, never from a flag', () => {
    expect(run(['secret', 'set', 'github-token', '--stdin'], TOKEN).code).toBe(0);
    const listed = JSON.parse(run(['--json', 'secret', 'ls']).stdout) as { secrets: string[] };
    // Names only — values are never listed.
    expect(listed.secrets).toContain('github-token');
    expect(JSON.stringify(listed)).not.toContain(TOKEN);
  });

  it('deploys the server to all three agents', () => {
    const applied = run(['apply']);
    expect(applied.code, applied.stdout).toBe(0);

    expect(readJson(join(home, '.claude.json')).mcpServers).toHaveProperty('github');
    expect(readJson(join(home, '.cursor', 'mcp.json')).mcpServers).toHaveProperty('github');
    expect(readFileSync(join(home, '.codex', 'config.toml'), 'utf8')).toContain(
      '[mcp_servers.github]',
    );
  });

  it('resolves the secret into the agent configs but never into the library', () => {
    expect(readFileSync(join(home, '.codex', 'config.toml'), 'utf8')).toContain(TOKEN);
    expect(storeContains('${secret:github-token}')).toBe(true);
    expect(storeContains(TOKEN)).toBe(false);
  });

  it('leaves every unrelated part of those files intact', () => {
    const codex = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
    expect(codex).toContain('# Codex configuration — hand written');
    expect(codex).toContain('[mcp_servers.node_repl]');
    expect(codex).toContain('startup_timeout_sec = 120');
    expect(codex).toContain('[plugins."browser@example-bundled"]');

    expect(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8')).toContain('// set up by hand');
    expect(readJson(join(home, '.claude.json')).numStartups).toBe(42);
  });

  it('is idempotent', () => {
    const result = run(['apply']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('already in sync');
  });
});

describe('routing MCP servers per agent', () => {
  it('honours a rule that excludes an agent, removing the entry there', () => {
    expect(run(['route', 'mcp/github', '--targets', 'claude', 'cursor']).code).toBe(0);
    expect(run(['apply']).code).toBe(0);

    const codex = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
    expect(codex).not.toContain('[mcp_servers.github]');
    // Removing our entry must not disturb the user's own.
    expect(codex).toContain('[mcp_servers.node_repl]');
    expect(readJson(join(home, '.cursor', 'mcp.json')).mcpServers).toHaveProperty('github');
  });

  it('warns rather than failing when an agent cannot speak the transport', () => {
    run(['add', 'mcp', 'streamer', '--url', 'https://example.com/sse', '--transport', 'sse']);
    const result = run(['--json', 'apply']);
    const parsed = JSON.parse(result.stdout) as { diagnostics: { message: string }[] };
    expect(parsed.diagnostics.map((d) => d.message).join()).toContain(
      'does not support the "sse" transport',
    );
    // …and the agents that do support it still get it.
    expect(readJson(join(home, '.cursor', 'mcp.json')).mcpServers).toHaveProperty('streamer');
  });
});

describe('protecting configuration it cannot understand', () => {
  it('refuses to touch an unparseable config, and says which file', () => {
    // Route something back to codex so there is a reason to open its config at all.
    run(['route', 'mcp/github', '--targets', 'claude', 'codex', 'cursor']);

    const path = join(home, '.codex', 'config.toml');
    const good = readFileSync(path, 'utf8');
    writeFileSync(path, `${good}\nbroken = = value\n`);

    const result = run(['--json', 'apply']);
    const parsed = JSON.parse(result.stdout) as { diagnostics: { message: string }[] };
    expect(parsed.diagnostics.map((d) => d.message).join()).toContain('will not touch it');
    expect(readFileSync(path, 'utf8')).toContain('broken = = value');

    writeFileSync(path, good);
  });
});

describe('drift in a hand-edited MCP entry', () => {
  it('asks instead of overwriting', () => {
    const path = join(home, '.cursor', 'mcp.json');
    const document = readJson(path) as unknown as {
      mcpServers: Record<string, { args?: string[] }>;
    };
    document.mcpServers.github = { ...document.mcpServers.github, args: ['-y', '--changed'] };
    writeFileSync(path, JSON.stringify(document, null, 2));

    const result = run(['apply']);
    expect(result.code).toBe(3);
    expect(result.stdout).toContain('edited by hand');
    expect(readFileSync(path, 'utf8')).toContain('--changed');
  });

  it('adopts the edit back into the library when asked', () => {
    // Exit 2 is fine here: unrelated capability warnings are still outstanding.
    expect(run(['apply', '--adopt']).code).not.toBe(3);
    const definition = readFileSync(
      join(home, '.agent-sync', 'store', 'mcp', 'github.yaml'),
      'utf8',
    );
    expect(definition).toContain('--changed');
  });
});

describe('import: adopting what was already on the machine', () => {
  it('reports without changing anything', () => {
    const result = run(['--json', 'import']);
    const parsed = JSON.parse(result.stdout) as { candidates: { id: string }[]; dryRun: boolean };
    expect(parsed.dryRun).toBe(true);
    expect(parsed.candidates.map((c) => c.id)).toContain('legacy');
    expect(existsSync(join(home, '.agent-sync', 'store', 'mcp', 'legacy.yaml'))).toBe(false);
  });

  it('adopts a pre-existing server and keeps its credential off git', () => {
    const result = run(['--json', 'import', '--adopt']);
    const parsed = JSON.parse(result.stdout) as { adopted: string[]; secretsStored: string[] };
    expect(parsed.adopted).toContain('mcp/legacy');
    expect(parsed.secretsStored.length).toBeGreaterThan(0);

    const definition = readFileSync(
      join(home, '.agent-sync', 'store', 'mcp', 'legacy.yaml'),
      'utf8',
    );
    expect(definition).toContain('${secret:');
    expect(definition).not.toContain(TOKEN);
  });

  it('does not then ask about the entry it just adopted', () => {
    const result = run(['apply']);
    expect(result.code).not.toBe(3);
    expect(result.stdout).not.toContain('not managed by agent-sync');
  });

  it('has nothing left that it would adopt on its own', () => {
    const parsed = JSON.parse(run(['--json', 'import']).stdout) as {
      candidates: { id: string; machineSpecific: boolean }[];
      adoptable: number;
    };
    expect(parsed.adoptable).toBe(0);
    // What remains is only what agent-sync deliberately leaves alone: servers carrying
    // absolute paths, which belong to this machine rather than to the library.
    expect(parsed.candidates.every((c) => c.machineSpecific)).toBe(true);
  });
});

describe('removing an MCP server', () => {
  it('takes it out of every agent and out of the library', () => {
    expect(run(['rm', 'mcp/github']).code).toBe(0);

    expect(readJson(join(home, '.claude.json')).mcpServers).not.toHaveProperty('github');
    expect(readJson(join(home, '.cursor', 'mcp.json')).mcpServers).not.toHaveProperty('github');
    expect(existsSync(join(home, '.agent-sync', 'store', 'mcp', 'github.yaml'))).toBe(false);

    // Servers agent-sync never managed are still there.
    expect(readJson(join(home, '.cursor', 'mcp.json')).mcpServers).toHaveProperty('existing');
  });
});

describe('leaving the agents’ own configuration alone', () => {
  it('flags a machine-specific server and does not adopt it by default', () => {
    // Shaped like Codex's bundled node_repl: absolute paths into an app bundle.
    const codexPath = join(home, '.codex', 'config.toml');
    writeFileSync(
      codexPath,
      `${readFileSync(codexPath, 'utf8')}
[mcp_servers.app_bundled]
command = "/Applications/Some.app/Contents/MacOS/server"
`,
    );

    const parsed = JSON.parse(run(['--json', 'import']).stdout) as {
      candidates: { id: string; machineSpecific: boolean; notes: string[] }[];
    };
    const bundled = parsed.candidates.find((c) => c.id === 'app_bundled');
    expect(bundled?.machineSpecific).toBe(true);
    expect(bundled?.notes.join()).toContain('absolute path');

    const adopted = JSON.parse(run(['--json', 'import', '--adopt']).stdout) as {
      adopted: string[];
    };
    expect(adopted.adopted).not.toContain('mcp/app_bundled');
  });

  it('adopts one when asked for it explicitly', () => {
    const result = JSON.parse(
      run(['--json', 'import', '--adopt', '--only', 'mcp/app_bundled']).stdout,
    ) as { adopted: string[] };
    expect(result.adopted).toEqual(['mcp/app_bundled']);
  });

  it('never offers an agent’s own bundled skills', () => {
    // Codex keeps its built-in skills in `.system`; they are not the user's to sync.
    mkdirSync(join(home, '.codex', 'skills', '.system', 'skill-creator'), { recursive: true });
    writeFileSync(
      join(home, '.codex', 'skills', '.system', 'skill-creator', 'SKILL.md'),
      '---\nname: skill-creator\ndescription: built in\n---\n',
    );

    const parsed = JSON.parse(run(['--json', 'import']).stdout) as { candidates: { id: string }[] };
    expect(parsed.candidates.map((c) => c.id)).not.toContain('skill-creator');
    expect(parsed.candidates.map((c) => c.id)).not.toContain('.system');
  });
});

describe('servers that cannot be carried to another computer', () => {
  it('spots a command that only resolves against a working directory', () => {
    // Shaped like Codex's bundled computer-use: a relative command plus a cwd, which a
    // portable definition cannot express — adopting it would deploy something broken.
    const codexPath = join(home, '.codex', 'config.toml');
    writeFileSync(
      codexPath,
      `${readFileSync(codexPath, 'utf8')}
[mcp_servers.relative_cmd]
command = "./Some.app/Contents/MacOS/server"
cwd = "."
`,
    );

    const parsed = JSON.parse(run(['--json', 'import']).stdout) as {
      candidates: { id: string; machineSpecific: boolean; notes: string[] }[];
    };
    const found = parsed.candidates.find((c) => c.id === 'relative_cmd');
    expect(found?.machineSpecific).toBe(true);
    expect(found?.notes.join()).toContain('relative path');
    expect(found?.notes.join()).toContain('working directory');
  });

  it('leaves a server that is switched off switched off', () => {
    const codexPath = join(home, '.codex', 'config.toml');
    writeFileSync(
      codexPath,
      `${readFileSync(codexPath, 'utf8')}
[mcp_servers.turned_off]
command = "node"
enabled = false
`,
    );

    const parsed = JSON.parse(run(['--json', 'import']).stdout) as {
      candidates: { id: string; notes: string[] }[];
    };
    expect(parsed.candidates.find((c) => c.id === 'turned_off')?.notes.join()).toContain(
      'switched off here',
    );
  });
});

describe('renaming on the way in', () => {
  beforeAll(() => {
    // Agents name servers freely; this one cannot be a library id as written.
    const path = join(home, '.cursor', 'mcp.json');
    const document = readJson(path) as unknown as { mcpServers: Record<string, unknown> };
    document.mcpServers['Docs by LangChain'] = { url: 'https://docs.example/mcp' };
    writeFileSync(path, JSON.stringify(document, null, 2));
  });

  it('explains that the name cannot be an id, and how to fix it', () => {
    const parsed = JSON.parse(run(['--json', 'import']).stdout) as {
      candidates: { id: string; notes: string[] }[];
    };
    const found = parsed.candidates.find((c) => c.id === 'Docs by LangChain');
    expect(found?.notes.join()).toContain('--as "Docs by LangChain=');
  });

  it('adopts it under a chosen id', () => {
    const result = JSON.parse(
      run([
        '--json',
        'import',
        '--adopt',
        '--as',
        'Docs by LangChain=docs-langchain',
        '--only',
        'mcp/docs-langchain',
      ]).stdout,
    ) as { adopted: string[] };
    expect(result.adopted).toEqual(['mcp/docs-langchain']);
    expect(existsSync(join(home, '.agent-sync', 'store', 'mcp', 'docs-langchain.yaml'))).toBe(true);
  });

  it('says plainly that the agent’s own entry is left in place', () => {
    const parsed = JSON.parse(
      run(['--json', 'import', '--as', 'Docs by LangChain=docs-langchain']).stdout,
    ) as { candidates: { id: string; notes: string[] }[] };
    // Already adopted, so it no longer appears — but the original is untouched.
    expect(parsed.candidates.map((c) => c.id)).not.toContain('docs-langchain');
    expect(readJson(join(home, '.cursor', 'mcp.json')).mcpServers).toHaveProperty(
      'Docs by LangChain',
    );
  });

  it('rejects a mapping to an invalid id', () => {
    const result = run(['import', '--as', 'Docs by LangChain=Not Valid']);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('is not a valid id');
  });
});

describe('MCP servers configured inside a project', () => {
  let project: string;

  const runIn = (args: readonly string[], cwd: string) => {
    try {
      return {
        code: 0,
        stdout: execFileSync(process.execPath, [CLI, ...args], {
          cwd,
          encoding: 'utf8',
          env: {
            ...process.env,
            HOME: home,
            USERPROFILE: home,
            GIT_AUTHOR_NAME: 'test',
            GIT_AUTHOR_EMAIL: 'test@example.com',
            GIT_COMMITTER_NAME: 'test',
            GIT_COMMITTER_EMAIL: 'test@example.com',
            NO_COLOR: '1',
          },
        }),
      };
    } catch (error) {
      const failed = error as { status?: number; stdout?: string; stderr?: string };
      return { code: failed.status ?? 1, stdout: `${failed.stdout ?? ''}${failed.stderr ?? ''}` };
    }
  };

  beforeAll(() => {
    project = join(workspace, 'a-project');
    mkdirSync(join(project, '.cursor'), { recursive: true });
    // Exactly the shape found in the wild: a project MCP file with a live token in it.
    writeFileSync(
      join(project, '.cursor', 'mcp.json'),
      JSON.stringify(
        {
          mcpServers: {
            'project-github': {
              command: 'npx',
              args: ['-y', 'server'],
              env: { GITHUB_PERSONAL_ACCESS_TOKEN: `github_pat_${'x'.repeat(50)}` },
            },
          },
        },
        null,
        2,
      ),
    );
  });

  it('finds a server declared inside a project, not just global ones', () => {
    const parsed = JSON.parse(runIn(['--json', 'import'], project).stdout) as {
      candidates: { id: string; notes: string[] }[];
    };
    const found = parsed.candidates.find((c) => c.id === 'project-github');
    expect(found).toBeDefined();
    expect(found?.notes.join()).toContain('not a registered project yet');
  });

  it('adopts it as a project server, with its token kept off git', () => {
    runIn(['link', 'a-project'], project);
    runIn(['import', '--adopt', '--only', 'mcp/project-github'], project);

    const manifest = readFileSync(join(home, '.agent-sync', 'store', 'agent-sync.yaml'), 'utf8');
    expect(manifest).toContain('mcp/project-github');
    expect(manifest).toContain('a-project');

    const definition = readFileSync(
      join(home, '.agent-sync', 'store', 'mcp', 'project-github.yaml'),
      'utf8',
    );
    expect(definition).toContain('${secret:');
    expect(definition).not.toContain('github_pat_');
  });
});
