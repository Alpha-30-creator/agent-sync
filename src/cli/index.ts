#!/usr/bin/env node
/**
 * agent-sync CLI.
 *
 * Every command is a thin composition of the pipeline: read the world, let the pure
 * core decide, execute, report. Commands never make decisions themselves.
 */
import { Command } from 'commander';
import { runApply, runStatus } from './commands/apply.js';
import { runImport } from './commands/import.js';
import { runClone, runInit } from './commands/init.js';
import { runAddSkill, runNewSkill, runRemove, runSave } from './commands/library.js';
import { runAddMcp, runSecret } from './commands/mcp.js';
import { runInclude, runLink, runRoute, runToggle, runUnlink } from './commands/project.js';
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
  .option('--project <id>', 'restrict to one project')
  .action(
    (options: {
      dryRun: boolean;
      adopt: boolean;
      overwrite: boolean;
      agent?: string[];
      project?: string;
    }) => {
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
          ...(options.project === undefined ? {} : { project: options.project }),
        }),
      );
    },
  );

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
  .option(
    '--scope <scope>',
    'global (default) or project — project-only skills deploy solely where a project includes them',
  )
  .description('copy an existing skill folder into the library')
  .action((path: string, options: { id?: string; targets?: string[]; scope?: string }) => {
    const g = globals();
    run(
      runAddSkill({
        path,
        json: g.json === true,
        ...(g.store === undefined ? {} : { storeOverride: g.store }),
        ...(options.id === undefined ? {} : { id: options.id }),
        ...(options.targets === undefined ? {} : { targets: options.targets }),
        ...(options.scope === 'project' ? { scope: 'project' as const } : {}),
      }),
    );
  });

add
  .command('mcp')
  .argument('<id>', 'lowercase-kebab id for the server')
  .option('--command <command>', 'executable to launch (stdio servers)')
  .option('--args <arg...>', 'arguments passed to the command')
  .option('--url <url>', 'endpoint (remote servers)')
  .option('--transport <transport>', 'http (default for --url) or sse')
  .option('--env <pair...>', 'environment values as KEY=value; use ${secret:name} for credentials')
  .option('--header <pair...>', 'headers as KEY=value (remote servers)')
  .option('--targets <agent...>', 'agents this server should deploy to')
  .description('add an MCP server definition to the library')
  .action(
    (
      id: string,
      options: {
        command?: string;
        args?: string[];
        url?: string;
        transport?: string;
        env?: string[];
        header?: string[];
        targets?: string[];
      },
    ) => {
      const g = globals();
      run(
        runAddMcp({
          id,
          json: g.json === true,
          ...(g.store === undefined ? {} : { storeOverride: g.store }),
          ...(options.command === undefined ? {} : { command: options.command }),
          ...(options.args === undefined ? {} : { args: options.args }),
          ...(options.url === undefined ? {} : { url: options.url }),
          ...(options.transport === undefined ? {} : { transport: options.transport }),
          ...(options.env === undefined ? {} : { env: options.env }),
          ...(options.header === undefined ? {} : { header: options.header }),
          ...(options.targets === undefined ? {} : { targets: options.targets }),
        }),
      );
    },
  );

program
  .command('import')
  .description('adopt skills and MCP servers already on this machine')
  .option('--adopt', 'actually bring them into the library (otherwise just reports)', false)
  .option('--agent <agent...>', 'restrict the scan to these agents')
  .action((options: { adopt: boolean; agent?: string[] }) => {
    const g = globals();
    run(
      runImport({
        adopt: options.adopt,
        json: g.json === true,
        ...(g.store === undefined ? {} : { storeOverride: g.store }),
        ...(options.agent === undefined ? {} : { agents: options.agent }),
      }),
    );
  });

const secret = program
  .command('secret')
  .description('manage credentials, stored on this device only');

secret
  .command('set')
  .argument('<name>', 'secret name, referenced as ${secret:name}')
  .option('--stdin', 'read the value from stdin', false)
  .description('store a secret value on this device')
  .action(async (name: string, options: { stdin: boolean }) => {
    const g = globals();
    run(
      await runSecret({
        action: 'set',
        name,
        stdin: options.stdin,
        json: g.json === true,
        ...(g.store === undefined ? {} : { storeOverride: g.store }),
      }),
    );
  });

secret
  .command('rm')
  .argument('<name>', 'secret name')
  .description('remove a secret from this device')
  .action(async (name: string) => {
    const g = globals();
    run(
      await runSecret({
        action: 'rm',
        name,
        stdin: false,
        json: g.json === true,
        ...(g.store === undefined ? {} : { storeOverride: g.store }),
      }),
    );
  });

secret
  .command('ls')
  .description('list secret names stored on this device (never values)')
  .action(async () => {
    const g = globals();
    run(
      await runSecret({
        action: 'ls',
        stdin: false,
        json: g.json === true,
        ...(g.store === undefined ? {} : { storeOverride: g.store }),
      }),
    );
  });

const create = program.command('new').description('scaffold a new artifact in the library');

create
  .command('skill')
  .argument('<id>', 'lowercase-kebab id')
  .option('--description <text>', 'one line describing when the skill applies')
  .option('--targets <agent...>', 'agents this skill should deploy to')
  .option(
    '--scope <scope>',
    'global (default) or project — project-only skills deploy solely where a project includes them',
  )
  .description('scaffold a skill in the library, so it is born synced')
  .action((id: string, options: { description?: string; targets?: string[]; scope?: string }) => {
    const g = globals();
    run(
      runNewSkill({
        id,
        json: g.json === true,
        ...(g.store === undefined ? {} : { storeOverride: g.store }),
        ...(options.description === undefined ? {} : { description: options.description }),
        ...(options.targets === undefined ? {} : { targets: options.targets }),
        ...(options.scope === 'project' ? { scope: 'project' as const } : {}),
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
  .command('link')
  .argument('[id]', 'project id (defaults to the directory name)')
  .description('register this directory as a project, on this device and in the library')
  .action((id: string | undefined) => {
    const g = globals();
    run(
      runLink({
        dir: process.cwd(),
        json: g.json === true,
        ...(g.store === undefined ? {} : { storeOverride: g.store }),
        ...(id === undefined ? {} : { id }),
      }),
    );
  });

program
  .command('unlink')
  .argument('[id]', 'project id (defaults to the marker in this directory)')
  .description('stop deploying a project on this device')
  .action((id: string | undefined) => {
    const g = globals();
    run(
      runUnlink({
        dir: process.cwd(),
        json: g.json === true,
        ...(g.store === undefined ? {} : { storeOverride: g.store }),
        ...(id === undefined ? {} : { id }),
      }),
    );
  });

program
  .command('include')
  .argument('<ref>', 'artifact reference, e.g. skill/db-migrate')
  .option('--project <id>', 'project to include it in (defaults to the current one)')
  .description('deploy an artifact into this project')
  .action((ref: string, options: { project?: string }) => {
    const g = globals();
    run(
      runInclude({
        ref,
        remove: false,
        dir: process.cwd(),
        json: g.json === true,
        ...(g.store === undefined ? {} : { storeOverride: g.store }),
        ...(options.project === undefined ? {} : { project: options.project }),
      }),
    );
  });

program
  .command('exclude')
  .argument('<ref>', 'artifact reference')
  .option('--project <id>', 'project to remove it from (defaults to the current one)')
  .description('stop deploying an artifact into this project')
  .action((ref: string, options: { project?: string }) => {
    const g = globals();
    run(
      runInclude({
        ref,
        remove: true,
        dir: process.cwd(),
        json: g.json === true,
        ...(g.store === undefined ? {} : { storeOverride: g.store }),
        ...(options.project === undefined ? {} : { project: options.project }),
      }),
    );
  });

program
  .command('route')
  .argument('[ref]', 'artifact reference; omit to route a whole type with --type')
  .option('--type <type>', 'artifact type: skill, mcp, or plugin')
  .option('--project <id>', 'scope the rule to a project ("here" for the current one)')
  .option('--targets <agent...>', 'exact set of agents ("all" for every agent)')
  .option('--add <agent...>', 'add agents to whatever the next rule up resolves to')
  .option('--remove <agent...>', 'remove agents from whatever the next rule up resolves to')
  .option('--clear', 'delete the rule, falling back up the ladder', false)
  .description('set which agents an artifact deploys to')
  .action(
    (
      ref: string | undefined,
      options: {
        type?: string;
        project?: string;
        targets?: string[];
        add?: string[];
        remove?: string[];
        clear: boolean;
      },
    ) => {
      const g = globals();
      run(
        runRoute({
          clear: options.clear,
          dir: process.cwd(),
          json: g.json === true,
          ...(g.store === undefined ? {} : { storeOverride: g.store }),
          ...(ref === undefined ? {} : { ref }),
          ...(options.type === undefined ? {} : { type: options.type }),
          ...(options.project === undefined ? {} : { project: options.project }),
          ...(options.targets === undefined ? {} : { targets: options.targets }),
          ...(options.add === undefined ? {} : { add: options.add }),
          ...(options.remove === undefined ? {} : { remove: options.remove }),
        }),
      );
    },
  );

program
  .command('disable')
  .argument('<ref>', 'artifact reference')
  .description('switch an artifact off on this device only')
  .action((ref: string) => {
    const g = globals();
    run(
      runToggle({
        ref,
        enable: false,
        json: g.json === true,
        ...(g.store === undefined ? {} : { storeOverride: g.store }),
      }),
    );
  });

program
  .command('enable')
  .argument('<ref>', 'artifact reference')
  .description('switch an artifact back on for this device')
  .action((ref: string) => {
    const g = globals();
    run(
      runToggle({
        ref,
        enable: true,
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

program.parseAsync().catch((error: unknown) => {
  failure(error instanceof Error ? error.message : String(error));
  process.exitCode = EXIT.error;
});
