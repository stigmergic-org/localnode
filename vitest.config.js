import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run tests sequentially to avoid overwhelming the RPC
    poolOptions: {
      threads: {
        singleThread: true
      }
    },
    // Longer timeout for RPC calls and Helios sync
    testTimeout: 30000,
    hookTimeout: 120000, // 2 minutes for Helios to sync on first run
    // Setup files
    setupFiles: ['./tests/setup.js'],
    // Global setup/teardown
    globalSetup: ['./tests/setup.js'],
    // Reporter
    reporters: ['verbose'],
    // Globals
    globals: true
  }
});

