import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';
import { extractErrorMessage } from './errors';

const failure = (data: unknown) =>
  new AxiosError('Request failed with status code 500', '500', undefined, undefined, {
    status: 500,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data,
  });

describe('extractErrorMessage', () => {
  it("shows the server's message, joined when there are several", () => {
    expect(extractErrorMessage(failure({ message: 'Invalid email or password' }), 'Fallback')).toBe('Invalid email or password');
    expect(extractErrorMessage(failure({ message: ['One.', 'Two.'] }), 'Fallback')).toBe('One. Two.');
  });

  it("shows the page's own words when the server gives no message, never the HTTP library's", () => {
    expect(extractErrorMessage(failure(undefined), 'Couldn’t save.')).toBe('Couldn’t save.');
    expect(extractErrorMessage(new Error('boom'), 'Couldn’t save.')).toBe('Couldn’t save.');
  });
});
