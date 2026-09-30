import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import axios from '../lib/apiClient';

export type Reply = { status: number; data?: unknown };

/** Routes every axios request to `handler` and records what was sent.
 * Call the returned `restore` in afterEach. */
export function fakeServer(handler: (config: InternalAxiosRequestConfig) => Reply) {
  const original = axios.defaults.adapter;
  const sent: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    sent.push(config);
    const { status, data } = handler(config);
    const response = { status, data, statusText: '', headers: {}, config };
    if (status >= 400) {
      throw new axios.AxiosError('fail', String(status), config, undefined, response);
    }
    return response;
  };
  axios.defaults.adapter = adapter;
  return {
    sent,
    restore: () => {
      axios.defaults.adapter = original;
    },
  };
}
