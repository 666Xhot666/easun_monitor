import axios from 'axios';
import type { ApiErrorBody } from '@eam/shared/auth';

/**
 * Nest's default HttpException body puts `message` as a plain string for a
 * hand-thrown exception (e.g. `UnauthorizedException('Invalid email or
 * password')`) but as a string[] when ValidationPipe rejects a DTO (one
 * entry per failed field) — this normalizes both into one display string.
 */
export function extractErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    const body = error.response?.data;
    if (body?.message) {
      return Array.isArray(body.message) ? body.message.join(' ') : body.message;
    }
  }
  // Anything else ("Network Error", a status line) is the library's English:
  // the caller's own words say it better, in the user's language.
  return fallback;
}
