import { defineConfig } from 'vitest/config'
import { TEST_DATABASE_URL } from './src/test/database-url.ts'

export default defineConfig({
  test: {
    globalSetup: ['./src/test/global-setup.ts'],
    // Test files share one database and clear tables between tests, so they run one at a time.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      SESSION_SECRET: 'test-session-secret-that-is-long-enough-000',
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    },
  },
})
