/** Tests run against a separate database, created and migrated by global-setup.ts. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://localhost:5432/train_smarter_test'
