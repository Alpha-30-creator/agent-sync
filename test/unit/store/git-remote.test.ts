import { describe, expect, it } from 'vitest';
import { normalizeRemote } from '../../../src/store/git.js';

describe('normalizeRemote', () => {
  it('reduces ssh and https forms of the same repo to one value', () => {
    const expected = 'github.com/abdur/acme-app';
    expect(normalizeRemote('git@github.com:abdur/acme-app.git')).toBe(expected);
    expect(normalizeRemote('https://github.com/abdur/acme-app.git')).toBe(expected);
    expect(normalizeRemote('https://github.com/abdur/acme-app')).toBe(expected);
    expect(normalizeRemote('ssh://git@github.com/abdur/acme-app.git')).toBe(expected);
    expect(normalizeRemote('git+https://github.com/abdur/acme-app.git')).toBe(expected);
  });

  it('ignores case, whitespace, and trailing slashes', () => {
    expect(normalizeRemote('  https://GitHub.com/Abdur/Acme-App/  ')).toBe(
      'github.com/abdur/acme-app',
    );
  });

  it('keeps a port intact rather than mistaking it for an scp-style path', () => {
    expect(normalizeRemote('ssh://git@example.com:2222/team/repo.git')).toBe(
      'example.com:2222/team/repo',
    );
  });

  it('leaves an unrecognised value alone rather than guessing', () => {
    expect(normalizeRemote('/srv/git/local-repo')).toBe('/srv/git/local-repo');
  });
});
