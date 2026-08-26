import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  backupFile,
  copyTree,
  ensureDir,
  fileHash,
  listFiles,
  readTextFile,
  removeTree,
  sha256,
  treeHash,
  writeFileAtomic,
} from '../../src/shell/fs.js';

let root: string;

beforeEach(() => {
  root = join(tmpdir(), `agent-sync-fs-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const write = (relativePath: string, content: string): string => {
  const path = join(root, relativePath);
  ensureDir(join(path, '..'));
  writeFileSync(path, content);
  return path;
};

describe('hashing', () => {
  it('hashes content, not paths', () => {
    expect(sha256('hello')).toBe(sha256('hello'));
    expect(sha256('hello')).not.toBe(sha256('world'));
  });

  it('returns null for a file or tree that does not exist', () => {
    expect(fileHash(join(root, 'nope'))).toBeNull();
    expect(treeHash(join(root, 'nope'))).toBeNull();
  });

  it('hashes a directory tree over both paths and content', () => {
    write('skill/SKILL.md', 'body');
    write('skill/scripts/run.sh', 'echo hi');
    const before = treeHash(join(root, 'skill'));

    write('skill/scripts/run.sh', 'echo bye');
    expect(treeHash(join(root, 'skill'))).not.toBe(before);
  });

  it('changes when a file is renamed, even if content is identical', () => {
    write('a/one.md', 'same');
    const before = treeHash(join(root, 'a'));
    rmSync(join(root, 'a/one.md'));
    write('a/two.md', 'same');
    expect(treeHash(join(root, 'a'))).not.toBe(before);
  });

  it('lists files deterministically, depth first', () => {
    write('t/b.md', '1');
    write('t/a/z.md', '1');
    write('t/a/a.md', '1');
    expect(listFiles(join(root, 't')).map((p) => p.split(/[\\/]/).join('/'))).toEqual([
      'a/a.md',
      'a/z.md',
      'b.md',
    ]);
  });
});

describe('atomic writes', () => {
  it('writes a file and creates missing parent directories', () => {
    const path = join(root, 'deep', 'nested', 'file.txt');
    writeFileAtomic(path, 'content');
    expect(readFileSync(path, 'utf8')).toBe('content');
  });

  it('replaces content without leaving temp files behind', () => {
    const path = join(root, 'file.txt');
    writeFileAtomic(path, 'first');
    writeFileAtomic(path, 'second');
    expect(readFileSync(path, 'utf8')).toBe('second');
    expect(listFiles(root).filter((f) => f.includes('.tmp'))).toEqual([]);
  });

  it('leaves the original intact when the write fails', () => {
    const path = join(root, 'file.txt');
    writeFileAtomic(path, 'original');
    // A directory where the temp file must go is not writable as a file.
    const blocked = join(root, 'blocked');
    mkdirSync(blocked);
    expect(() => writeFileAtomic(blocked, 'nope')).toThrow();
    expect(readFileSync(path, 'utf8')).toBe('original');
  });
});

describe('tree operations', () => {
  it('copies a tree exactly', () => {
    write('src/SKILL.md', 'body');
    write('src/refs/extra.md', 'more');
    copyTree(join(root, 'src'), join(root, 'dst'));
    expect(treeHash(join(root, 'dst'))).toBe(treeHash(join(root, 'src')));
  });

  it('replaces the destination rather than merging into it', () => {
    write('src/keep.md', 'a');
    write('dst/stale.md', 'b');
    copyTree(join(root, 'src'), join(root, 'dst'));
    expect(existsSync(join(root, 'dst', 'stale.md'))).toBe(false);
  });

  it('removes a tree, and tolerates removing one that is absent', () => {
    write('gone/file.md', 'x');
    removeTree(join(root, 'gone'));
    expect(existsSync(join(root, 'gone'))).toBe(false);
    expect(() => removeTree(join(root, 'never-existed'))).not.toThrow();
  });
});

describe('backups', () => {
  it('copies a file into the backup directory before it is edited', () => {
    const path = write('config.toml', 'original');
    const backup = backupFile(path, join(root, 'backups'), '20260825-120000');
    expect(backup).not.toBeNull();
    expect(readTextFile(backup as string)).toBe('original');
  });

  it('returns null when there is nothing to back up', () => {
    expect(backupFile(join(root, 'absent'), join(root, 'backups'), 'stamp')).toBeNull();
  });
});

describe('comparing content rather than encoding', () => {
  it('treats a file as unchanged when only its line endings differ', () => {
    // git on Windows rewrites line endings on checkout, so a project skill arrives
    // with CRLF. That must not read as somebody having edited it.
    write('lf/SKILL.md', 'one\ntwo\nthree\n');
    const unix = treeHash(join(root, 'lf'));

    write('lf/SKILL.md', 'one\r\ntwo\r\nthree\r\n');
    expect(treeHash(join(root, 'lf'))).toBe(unix);
  });

  it('still notices a real change', () => {
    write('real/SKILL.md', 'one\ntwo\n');
    const before = treeHash(join(root, 'real'));
    write('real/SKILL.md', 'one\r\ntwo\r\nthree\r\n');
    expect(treeHash(join(root, 'real'))).not.toBe(before);
  });

  it('hashes binary content exactly, without rewriting anything', () => {
    const withCrlf = Buffer.from([0x00, 0x0d, 0x0a, 0x01]);
    const withLf = Buffer.from([0x00, 0x0a, 0x01]);
    writeFileSync(join(root, 'a.bin'), withCrlf);
    writeFileSync(join(root, 'b.bin'), withLf);
    expect(fileHash(join(root, 'a.bin'))).not.toBe(fileHash(join(root, 'b.bin')));
  });
});
