import { withTimeout } from './with-timeout';

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('passes the result through when it comes in time', async () => {
    await expect(
      withTimeout(Promise.resolve(7), 1000, 'too slow'),
    ).resolves.toBe(7);
  });

  it('fails with the message and runs the cleanup when it does not', async () => {
    const onTimeout = jest.fn();
    const pending = withTimeout(
      new Promise(() => {}),
      1000,
      'Connecting took over 1 s',
      onTimeout,
    );
    jest.advanceTimersByTime(1000);

    await expect(pending).rejects.toThrow('Connecting took over 1 s');
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('passes a failure through and does not clean up', async () => {
    const onTimeout = jest.fn();
    await expect(
      withTimeout(
        Promise.reject(new Error('refused')),
        1000,
        'too slow',
        onTimeout,
      ),
    ).rejects.toThrow('refused');
    jest.advanceTimersByTime(2000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
