import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';

/**
 * Fills `env` from .env files without overriding anything already set:
 * the process environment wins, then the files in the order given. Empty
 * values count as unset (the root .env, copied from .env.example, has empty
 * placeholders). Returns the files that were found.
 */
export function loadEnvFiles(
  paths: string[],
  env: Record<string, string | undefined>,
): string[] {
  const loaded: string[] = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    loaded.push(path);
    for (const [key, value] of Object.entries(parse(readFileSync(path)))) {
      if (value !== '' && (env[key] === undefined || env[key] === ''))
        env[key] = value;
    }
  }
  return loaded;
}
