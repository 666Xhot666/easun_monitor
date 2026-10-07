/**
 * `promise`, or a failure with `message` once `ms` pass without it settling;
 * `onTimeout` then runs to abandon the work (CoreBluetooth never times out a
 * connect by itself, so a BMS that stops answering would otherwise hang the
 * reader forever).
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(message));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
