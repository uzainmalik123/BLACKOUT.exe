import { describe, expect, it } from 'vitest';
import { basename, byteCompare, dirname, resolvePath } from './path';

describe('resolvePath', () => {
  it('joins a relative path onto cwd', () => {
    expect(resolvePath('/var/log', 'nginx/access.log')).toBe('/var/log/nginx/access.log');
  });
  it('keeps an absolute path and ignores cwd', () => {
    expect(resolvePath('/var/log', '/etc/passwd')).toBe('/etc/passwd');
  });
  it('collapses . and ..', () => {
    expect(resolvePath('/a/b', './c/../../d')).toBe('/a/d');
  });
  it('keeps .. at / at /', () => {
    expect(resolvePath('/', '..')).toBe('/');
    expect(resolvePath('/a', '../../../..')).toBe('/');
    expect(resolvePath('/', '/../x')).toBe('/x');
  });
  it('removes a trailing slash and collapses doubled slashes', () => {
    expect(resolvePath('/', '/var/log/')).toBe('/var/log');
    expect(resolvePath('/', '//var///log//')).toBe('/var/log');
  });
  it('treats an empty input as cwd', () => {
    expect(resolvePath('/tmp', '')).toBe('/tmp');
  });
  it('resolves the root', () => {
    expect(resolvePath('/x', '/')).toBe('/');
  });
});

describe('dirname and basename', () => {
  it('handles ordinary, top-level and root paths', () => {
    expect(dirname('/a/b')).toBe('/a');
    expect(dirname('/a')).toBe('/');
    expect(dirname('/')).toBe('/');
    expect(dirname('a')).toBe('.');
    expect(basename('/a/b')).toBe('b');
    expect(basename('/')).toBe('/');
  });
  it('ignores a trailing slash', () => {
    expect(dirname('/a/b/')).toBe('/a');
    expect(basename('/a/b/')).toBe('b');
  });
});

describe('byteCompare', () => {
  it('orders uppercase before lowercase', () => {
    expect(byteCompare('B', 'a')).toBeLessThan(0);
  });
});
