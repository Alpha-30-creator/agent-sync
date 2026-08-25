/**
 * Output and the agent-mode contract (docs/09-agent-native.md §4.2).
 *
 * Agents drive this CLI as a first-class interface, so: never prompt when stdout is
 * not a TTY, always offer `--json` with a stable `schemaVersion`, and keep the exit
 * codes meaningful (0 ok, 1 error, 2 warnings, 3 needs a decision).
 */
import pc from 'picocolors';

export const SCHEMA_VERSION = 1;

export const isInteractive = (): boolean => process.stdout.isTTY === true;

export type JsonEnvelope = {
  readonly schemaVersion: number;
  readonly command: string;
  readonly ok: boolean;
} & Record<string, unknown>;

export const emitJson = (command: string, ok: boolean, payload: Record<string, unknown>): void => {
  const envelope = {
    schemaVersion: SCHEMA_VERSION,
    command,
    ok,
    ...payload,
  } satisfies JsonEnvelope;
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
};

export const line = (text = ''): void => {
  process.stdout.write(`${text}\n`);
};

export const success = (text: string): void => line(`${pc.green('✔')} ${text}`);
export const warn = (text: string): void => line(`${pc.yellow('⚠')} ${text}`);
export const failure = (text: string): void => {
  process.stderr.write(`${pc.red('✖')} ${text}\n`);
};
export const info = (text: string): void => line(`${pc.dim(text)}`);

/**
 * Exit codes are part of the contract agents branch on, so they are named rather than
 * scattered as literals.
 */
export const EXIT = {
  ok: 0,
  error: 1,
  warnings: 2,
  needsDecision: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export const exitWith = (code: ExitCode): never => {
  process.exitCode = code;
  // Returning rather than calling process.exit keeps stdout flushed on Windows.
  return undefined as never;
};
