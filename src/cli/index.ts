#!/usr/bin/env node
/**
 * agent-sync CLI.
 *
 * Every command is a thin composition of the pipeline: read the world, let the pure
 * core decide, execute, report. Commands never make decisions themselves.
 */
import { Command } from 'commander';
import { runApply, runStatus } from './commands/apply.js';
import { runClone, runInit } from './commands/init.js';
import { runAddSkill, runNewSkill, runRemove, runSave } from './commands/library.js';
import { runDoctor, runSync } from './commands/sync.js';
import { EXIT, failure } from './output.js';

const program = new Command();

interface GlobalOptions {
  readonly store?: string;
  readonly json?: boolean;
}

const globals = (): GlobalOptions => program.opts<GlobalOptions>();

const run = (code: number): void => {
  process.exitCode = code;
};

program
  .name('agent-sync')
  .description('Sync skills, MCP servers, and plugins across coding agents and devices')
  .version('0.0.0')
  .option('--store <path>', 'use a store other than ~/.agent-sync')
  .option('--json', 'machine-readable output (stable schemaVersion)', false);

program
  .command('init')
  .description('create the canonical store and register this machine')
  .option('--remote <git-url>', 'git remote to sync the library through')
  .option('--device <name>', 'name for this machine')
  .action((options: { remote?: string; device?: string }) => {
    const g = globals();
    run(
      runInit({
        json: g.json === true,
        ...(g.store === undefined ? {} : { storeOverride: g.store }),
        ...(options.remote === undefined ? {} : { remote: options.remote }),
        ...(options.device === undefined ? {} : { deviceName: options.device }),
      }),
    );
  });

program
  .command('clone')
  .argument('<git-url>', 'store repository to clone')
  .description('set this machine up from an existing library')
  .option('--device <name>', 'name for this machine')
  .action((url: string, options: { device?: string }) => {
    const g = globals();
    run(
      runClone({
        url,
        json: g.json === true,
        ...(g.store === undefined ? {} : { storeOverride: g.store }),
        ...(options.device === undefined ? {} : { deviceName: options.device }),
      }),
    );
  });

program
  .command('apply')
  .description('make this machine match the library')
  .option('--dry-run', 'show the plan without changing anything', false)
  .option('--adopt', 'keep hand-edited files, copying them back into the library', false)
  .option('--overwrite', 'replace hand-edited files with the library version', false)
  .option('--agent <agent...>', 'restrict to these agents')
  .action((options: { dryRun: boolean; adopt: boolean; overwrite: boolean; agent?: string[] }) => {
    const g = globals();
    if (options.adopt && options.overwrite) {
      failure('--adopt and --overwrite contradict each other; pick one');
      run(EXIT.error);
      return;
    }
    run(
      runApply({
        dryRun: options.dryRun,
        adopt: options.adopt,
        overwrite: options.overwrite,
        json: g.json === true,
        ...(g.store === undefined ? {} : { storeOverride: g.store }),
        ...(options.agent === undefined ? {} : { agents: options.agent }),
      }),
    );
  });

program
  .command('status')
  .description('show what is deployed where, and what is out of date')
  .option('--why', 'explain which rule produced each deployment', false)
  .action((options: { why: boolean }) => {
    const g = globals();
    run(
      runStatus({
        why: options.why,
        json: g.json === true,
        ...(g.store === undefined ? {} : { storeOverride: g.store }),
      }),
    );
  });

program
  .command('sync')
  .description('pull, apply, and push — the daily loop')
  .option('--no-push', 'apply locally without pushing')
  .action((options: { push: boolean }) => {
    const g = globals();
    run(
      runSync({
        push: options.push,
        json: g.json === true,
        ...(g.store === undefined ? {} : { storeOverride: g.store }),
      }),
    );
  });

const add = program.command('add').description('bring an existing artifact into the library');

add
  .command('skill')
  .argument('<path>', 'directory containing a SKILL.md')
  .option('--id <id>', 'id to store it under (defaults to the directory name)')
  .option('--targets <agent...>', 'agents this skill should deploy to')
  .description('copy an existing skill folder into the library')
  .action((path: string, options: { id?: string; targets?: string[] }) => {
    const g = globals();
    run(
      runAddSkill({
        path,
        json: g.json === true,
        ...(g.store === undefined ? {} : { storeOverride: g.store }),
        ...(options.id === undefined ? {} : { id: options.id }),
        ...(options.targets === undefined ? {} : { targets: options.targets }),
      }),
    );
  });

const create = program.command('new').description('scaffold a new artifact in the library');

create
  .command('skill')
  .argument('<id>', 'lowercase-kebab id')
  .option('--description <text>', 'one line describing when the skill applies')
  .option('--targets <agent...>', 'agents this skill should deploy to')
  .description('scaffold a skill in the library, so it is born synced')
  .action((id: string, options: { description?: string; targets?: string[] }) => {
    const g = globals();
    run(
      runNewSkill({
        id,
        json: g.json === true,
        ...(g.store === undefined ? {} : { storeOverride: g.store }),
        ...(options.description === undefined ? {} : { description: options.description }),
        ...(options.targets === undefined ? {} : { targets: options.targets }),
      }),
    );
  });

program
  .command('save')
  .description('validate, apply, commit, and push — one transaction')
  .option('-m, --message <text>', 'commit message')
  .option('--no-push', 'commit without pushing')
  .action((options: { message?: string; push: boolean }) => {
    const g = globals();
    run(
      runSave({
        push: options.push,
        json: g.json === true,
        ...(g.store === undefined ? {} : { storeOverride: g.store }),
        ...(options.message === undefined ? {} : { message: options.message }),
      }),
    );
  });

program
  .command('rm')
  .argument('<ref>', 'artifact reference, e.g. skill/db-migrate')
  .description('remove an artifact from the library and from every agent')
  .action((ref: string) => {
    const g = globals();
    run(
      runRemove({
        ref,
        json: g.json === true,
        ...(g.store === undefined ? {} : { storeOverride: g.store }),
      }),
    );
  });

program
  .command('doctor')
  .description('check this machine: agents, git, store health')
  .action(() => {
    const g = globals();
    run(
      runDoctor({
        json: g.json === true,
        ...(g.store === undefined ? {} : { storeOverride: g.store }),
      }),
    );
  });

program.parse();
