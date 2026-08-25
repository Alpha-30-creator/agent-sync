import { describe, expect, it } from 'vitest';
import {
  isWindows,
  joinPath,
  type MachineFacts,
  separator,
  underHome,
} from '../../../src/core/model/machine.js';

const mac: MachineFacts = { platform: 'darwin', home: '/Users/abdur' };
const win: MachineFacts = { platform: 'win32', home: 'C:\\Users\\Abdur' };
const linux: MachineFacts = { platform: 'linux', home: '/home/abdur' };

describe('machine paths', () => {
  it('picks the separator from the target machine, not the host', () => {
    expect(separator(mac)).toBe('/');
    expect(separator(linux)).toBe('/');
    expect(separator(win)).toBe('\\');
  });

  it('identifies windows', () => {
    expect(isWindows(win)).toBe(true);
    expect(isWindows(mac)).toBe(false);
  });

  it('joins with the target separator', () => {
    expect(joinPath(mac, '/Users/abdur', '.claude', 'skills')).toBe('/Users/abdur/.claude/skills');
    expect(joinPath(win, 'C:\\Users\\Abdur', '.claude', 'skills')).toBe(
      'C:\\Users\\Abdur\\.claude\\skills',
    );
  });

  it('drops empty segments and trailing separators', () => {
    expect(joinPath(mac, '/Users/abdur/', '', '.codex')).toBe('/Users/abdur/.codex');
    expect(joinPath(win, 'C:\\Users\\Abdur\\', '.codex\\')).toBe('C:\\Users\\Abdur\\.codex');
  });

  it('resolves under home for every platform', () => {
    expect(underHome(mac, '.cursor', 'mcp.json')).toBe('/Users/abdur/.cursor/mcp.json');
    expect(underHome(win, '.cursor', 'mcp.json')).toBe('C:\\Users\\Abdur\\.cursor\\mcp.json');
    expect(underHome(linux, '.cursor', 'mcp.json')).toBe('/home/abdur/.cursor/mcp.json');
  });
});
