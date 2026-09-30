import { parse } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// e2e tests run on the host against the compose Postgres, in a separate
// eam_test database so they never touch real telemetry. Only the database
// credentials are taken from the root .env; every other setting uses the
// app's own defaults unless a test sets it.
const envFile = resolve(__dirname, '../../.env');
const env = existsSync(envFile) ? parse(readFileSync(envFile)) : {};

const user = env.POSTGRES_USER ?? 'eam_user';
const password = env.POSTGRES_PASSWORD ?? 'eam_password';
const port = env.DB_PORT ?? '5432';

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  `postgresql://${user}:${password}@localhost:${port}/eam_test?schema=public`;
process.env.JWT_SECRET ??= 'test-secret';
process.env.POLLING_INTERVAL_MS ??= '5000';
// Most suites register several users; the closed-registration default has
// its own test in auth-hardening.e2e-spec.ts.
process.env.ALLOW_REGISTRATION ??= 'true';
