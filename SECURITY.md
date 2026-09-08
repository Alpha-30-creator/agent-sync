# Security

## Reporting a vulnerability

Report privately through GitHub's [security advisories](https://github.com/Alpha-30-creator/agent-sync/security/advisories/new)
rather than opening an issue. You should get an initial response within a week.

## What agent-sync touches

Worth stating plainly, because it explains what a vulnerability here would mean.

agent-sync reads and writes the configuration files your coding agents use:
`~/.claude.json`, `~/.codex/config.toml`, `~/.cursor/mcp.json`, and the skill directories
alongside them, plus their per-project equivalents. It runs `git` and, for
`--create-remote` only, the GitHub CLI. It makes no network requests of its own.

Three properties are load-bearing, and a break in any of them is a security bug rather
than an ordinary one:

- **Credentials never enter the library.** MCP configuration in the git-backed library
  holds references (`${secret:name}`), never values. Values live in a per-device file
  outside the repository, and the CLI refuses a literal-looking credential rather than
  committing one. A path that lets a secret reach the library is a vulnerability.
- **Configuration is edited surgically, or not at all.** Writes splice the managed entry
  and leave every other byte alone, after taking a backup. A file that cannot be parsed
  is refused rather than rewritten. A path that clobbers or corrupts unrelated
  configuration is a vulnerability.
- **Nothing that needs judgement happens unattended.** Drift and conflicts stop and ask.

## What is not a vulnerability

- agent-sync deploying content from your own library. It is your git repository; if
  something untrusted is in it, that is upstream of this tool.
- Your git remote's access control. agent-sync uses whatever authentication your `git`
  already has and never handles credentials for it.
