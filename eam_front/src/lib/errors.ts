import axios from 'axios';
import type { ApiErrorBody } from '../auth/types';

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
    if (error.message) return error.message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
