/**
 * Snapshot of the machine: the facts the pure core needs, read once at the edge so
 * that nothing downstream touches the environment (ADR 0004).
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import type { MachineFacts } from '../core/model/machine.js';
import { AGENT_IDS, type AgentId } from '../core/model/types.js';

export const readMachineFacts = (): MachineFacts => {
  const current = platform();
  return {
    platform: current === 'win32' ? 'win32' : current === 'darwin' ? 'darwin' : 'linux',
    home: homedir(),
  };
};

/** CLI binary and home directory that indicate an agent is installed. */
const FOOTPRINT: Readonly<Record<AgentId, { bin: string; dir: string }>> = {
  claude: { bin: 'claude', dir: '.claude' },
  codex: { bin: 'codex', dir: '.codex' },
  cursor: { bin: 'cursor-agent', dir: '.cursor' },
};

const onPath = (bin: string): boolean => {
  const isWindows = platform() === 'win32';
  try {
    execFileSync(isWindows ? 'where' : 'which', [bin], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
};

/**
 * Agents present on this machine.
 *
 * Detection keys on the CLI or the agent's home directory — never on a skills folder,
 * which agents create lazily and which was absent on a working Windows install
 * (docs/02-agent-landscape.md §5a).
 */
export const detectAgents = (facts: MachineFacts): readonly AgentId[] =>
  AGENT_IDS.filter((agent) => {
    const footprint = FOOTPRINT[agent];
    return onPath(footprint.bin) || existsSync(join(facts.home, footprint.dir));
  });

/** Version reported by an agent's CLI, for comparison against the capability table. */
export const agentVersion = (agent: AgentId): string | null => {
  const bin = FOOTPRINT[agent].bin;
  const options = {
    encoding: 'utf8' as const,
    stdio: ['ignore', 'pipe', 'ignore'] as ('ignore' | 'pipe')[],
    timeout: 10_000,
  };
  try {
    // Windows needs a shell, because agents install as `.cmd`/`.ps1` shims that cannot
    // be executed directly. Node deprecated passing an *args array* alongside
    // `shell: true` (DEP0190) and prints a security warning on every call — which showed
    // up in `doctor` output on Windows, where cursor-agent is a `.ps1`. One command
    // string is the supported form.
    const output =
      platform() === 'win32'
        ? execSync(`${bin} --version`, options)
        : execFileSync(bin, ['--version'], options);
    return output.trim().split('\n')[0] ?? null;
  } catch {
    return null;
  }
};

/** Timestamp used to name backups within a single run. */
export const runStamp = (now: Date): string =>
  now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
