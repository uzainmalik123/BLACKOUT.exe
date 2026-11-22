import { describe, expect, it } from 'vitest';
import { checkCommandLine } from './index';

describe('checkCommandLine', () => {
  it('accepts listed commands, alone and piped, with a redirect', () => {
    expect(checkCommandLine('ls -la')).toBe(true);
    expect(checkCommandLine('cat a | grep b | wc -l')).toBe(true);
    expect(checkCommandLine('grep x a > /tmp/out')).toBe(true);
  });

  it('rejects an unknown name in any stage', () => {
    expect(checkCommandLine('sudo ls')).toBe(false);
    expect(checkCommandLine('ls | bash')).toBe(false);
  });

  it('rejects parse errors and empty lines without throwing', () => {
    expect(checkCommandLine('ls; pwd')).toBe(false);
    expect(checkCommandLine("echo 'x")).toBe(false);
    expect(checkCommandLine('')).toBe(false);
    expect(checkCommandLine('   ')).toBe(false);
  });
});
