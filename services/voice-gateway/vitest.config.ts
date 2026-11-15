import { defineConfig } from 'vitest/config';

// Own config so this service never picks up the Next.js app's config one folder up.
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.test.ts'], testTimeout: 20_000 } });
