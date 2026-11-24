import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'], // server/: the Kiro server (SYS-12); live.test.ts skips itself unless KIRO_LIVE=1
  },
});
