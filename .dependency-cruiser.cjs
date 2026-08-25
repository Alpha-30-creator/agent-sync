/**
 * Enforces the functional-core boundary from ADR 0004: src/core is pure.
 * If a change needs core to reach for I/O, the design is wrong — not this rule.
 */
module.exports = {
  forbidden: [
    {
      name: 'core-imports-no-shell',
      severity: 'error',
      comment: 'src/core must not depend on effectful layers (shell, store, cli, adapters/*/reader|writer).',
      from: { path: '^src/core' },
      to: { path: '^src/(shell|store|cli)' },
    },
    {
      name: 'core-imports-no-node-io',
      severity: 'error',
      comment: 'src/core must not import Node I/O builtins — no fs, processes, clock-ish or network modules.',
      from: { path: '^src/core' },
      to: {
        dependencyTypes: ['core'],
        path: '^(node:)?(fs|fs/promises|child_process|os|net|http|https|dns|readline|worker_threads|perf_hooks|crypto)$',
      },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make the layering unverifiable.',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
  },
};
