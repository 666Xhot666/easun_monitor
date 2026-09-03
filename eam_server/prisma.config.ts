import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Deliberately process.env, not the env() helper: env() throws if the
    // var is unset, but `prisma generate` (no DB needed) runs during the
    // Docker *build* stage, before docker-compose has injected DATABASE_URL
    // as a real container env var. process.env.DATABASE_URL just comes back
    // undefined there, which generate doesn't care about; migrate/studio
    // always run against the live container, where it's set for real.
    url: process.env.DATABASE_URL,
  },
});
