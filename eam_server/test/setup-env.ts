import { config } from 'dotenv';
import { resolve } from 'node:path';

// e2e tests run on the host against the compose Postgres, in a separate
// eam_test database so they never touch real telemetry.
config({ path: resolve(__dirname, '../../.env'), quiet: true });

const user = process.env.POSTGRES_USER ?? 'eam_user';
const password = process.env.POSTGRES_PASSWORD ?? 'eam_password';
const port = process.env.DB_PORT ?? '5432';

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  `postgresql://${user}:${password}@localhost:${port}/eam_test?schema=public`;
process.env.JWT_SECRET ??= 'test-secret';
process.env.POLLING_INTERVAL_MS ??= '5000';
