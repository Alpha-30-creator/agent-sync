import { describe, expect, it } from 'vitest';
import {
  agentsSupporting,
  CAPABILITIES,
  supportsArtifact,
} from '../../../src/adapters/capability-table.js';
import type { MachineFacts } from '../../../src/core/model/machine.js';
import { AGENT_IDS } from '../../../src/core/model/types.js';

const mac: MachineFacts = { platform: 'darwin', home: '/Users/abdur' };
const win: MachineFacts = { platform: 'win32', home: 'C:\\Users\\Abdur' };

describe('verified layouts (docs/02-agent-landscape.md §5a, §5b)', () => {
  it('resolves global skill roots on macOS', () => {
    expect(CAPABILITIES.claude.globalSkillsRoot(mac)).toBe('/Users/abdur/.claude/skills');
    expect(CAPABILITIES.codex.globalSkillsRoot(mac)).toBe('/Users/abdur/.codex/skills');
    expect(CAPABILITIES.cursor.globalSkillsRoot(mac)).toBe('/Users/abdur/.cursor/skills');
  });

  it('resolves the same layout on Windows, with backslashes', () => {
    // Verified on Windows 11: every agent uses %USERPROFILE% dot-directories.
    expect(CAPABILITIES.claude.globalSkillsRoot(win)).toBe('C:\\Users\\Abdur\\.claude\\skills');
    expect(CAPABILITIES.codex.globalSkillsRoot(win)).toBe('C:\\Users\\Abdur\\.codex\\skills');
    expect(CAPABILITIES.cursor.globalSkillsRoot(win)).toBe('C:\\Users\\Abdur\\.cursor\\skills');
  });

  it('resolves project skill roots', () => {
    expect(CAPABILITIES.claude.projectSkillsRoot(mac, '/dev/acme')).toBe(
      '/dev/acme/.claude/skills',
    );
    expect(CAPABILITIES.cursor.projectSkillsRoot(win, 'D:\\dev\\acme')).toBe(
      'D:\\dev\\acme\\.cursor\\skills',
    );
  });

  it('marks the two shared config files that must be edited surgically', () => {
    expect(CAPABILITIES.claude.globalMcp(mac)).toEqual({
      path: '/Users/abdur/.claude.json',
      format: 'json',
      container: ['mcpServers'],
      shared: true,
    });
    expect(CAPABILITIES.codex.globalMcp(mac)).toMatchObject({
      path: '/Users/abdur/.codex/config.toml',
      format: 'toml',
      shared: true,
    });
  });

  it('treats dedicated MCP files as unshared', () => {
    expect(CAPABILITIES.cursor.globalMcp(mac)?.shared).toBe(false);
    expect(CAPABILITIES.claude.projectMcp(mac, '/dev/acme')).toMatchObject({
      path: '/dev/acme/.mcp.json',
      shared: false,
    });
    expect(CAPABILITIES.codex.projectMcp(mac, '/dev/acme')?.path).toBe(
      '/dev/acme/.codex/config.toml',
    );
    expect(CAPABILITIES.cursor.projectMcp(mac, '/dev/acme')?.path).toBe(
      '/dev/acme/.cursor/mcp.json',
    );
  });

  it('records that Cursor also discovers other agents skill directories', () => {
    expect(CAPABILITIES.cursor.alsoDiscovers).toContain('.claude/skills');
    expect(CAPABILITIES.claude.alsoDiscovers).toEqual([]);
  });

  it('knows plugins are supported by claude and codex but not cursor', () => {
    expect(supportsArtifact('claude', 'plugin')).toBe(true);
    expect(supportsArtifact('codex', 'plugin')).toBe(true);
    expect(supportsArtifact('cursor', 'plugin')).toBe(false);
    expect(agentsSupporting('plugin')).toEqual(['claude', 'codex']);
    expect(agentsSupporting('skill')).toEqual([...AGENT_IDS]);
  });

  it('records the agent versions each layout was verified against', () => {
    for (const agent of AGENT_IDS) {
      expect(CAPABILITIES[agent].verifiedAgainst.length).toBeGreaterThan(0);
    }
  });
});
