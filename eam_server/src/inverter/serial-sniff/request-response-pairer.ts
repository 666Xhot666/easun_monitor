import type { RtuRequestFrame } from './rtu-request-parser';
import type { RtuResponseFrame } from './rtu-response-parser';

/** A frame decoded on one of the two taps, stamped when it was decoded. */
export type TapEvent =
  | { dir: 'tx'; at: number; request: RtuRequestFrame }
  | { dir: 'rx'; at: number; response: RtuResponseFrame };

export type PairResult =
  | { kind: 'pair'; request: RtuRequestFrame; requestAt: number; response: RtuResponseFrame; responseAt: number }
  | { kind: 'unanswered'; request: RtuRequestFrame; requestAt: number }
  | { kind: 'orphan'; response: RtuResponseFrame; responseAt: number };

/**
 * Pairs read requests (request tap) with their responses (response tap).
 * The bus is half-duplex, so frames answer in order; but the two taps are
 * separate devices with different delays, so either side may be decoded
 * first. A request and a response pair when they are the oldest waiting
 * ones whose sizes fit (2 bytes per requested register) and lie within
 * `windowMs` of each other. Anything still unmatched after the window is
 * reported as unanswered (request) or orphan (response) by `flush`.
 */
export class RequestResponsePairer {
  private readonly windowMs: number;
  private requests: { request: RtuRequestFrame; at: number }[] = [];
  private responses: { response: RtuResponseFrame; at: number }[] = [];

  constructor(options: { windowMs?: number } = {}) {
    this.windowMs = options.windowMs ?? 1000;
  }

  push(event: TapEvent): PairResult[] {
    if (event.dir === 'tx') {
      const index = this.responses.findIndex(
        (r) => fits(event.request, r.response) && Math.abs(r.at - event.at) <= this.windowMs,
      );
      if (index < 0) {
        this.requests.push({ request: event.request, at: event.at });
        return [];
      }
      const [{ response, at }] = this.responses.splice(index, 1);
      return [{ kind: 'pair', request: event.request, requestAt: event.at, response, responseAt: at }];
    }

    const index = this.requests.findIndex(
      (r) => fits(r.request, event.response) && Math.abs(event.at - r.at) <= this.windowMs,
    );
    if (index < 0) {
      this.responses.push({ response: event.response, at: event.at });
      return [];
    }
    const [{ request, at }] = this.requests.splice(index, 1);
    return [{ kind: 'pair', request, requestAt: at, response: event.response, responseAt: event.at }];
  }

  /** Reports requests and responses left unmatched for longer than the window. */
  flush(now: number): PairResult[] {
    const expired = (at: number) => now - at > this.windowMs;
    const results: PairResult[] = [
      ...this.requests.filter((r) => expired(r.at)).map((r) => ({ kind: 'unanswered' as const, request: r.request, requestAt: r.at })),
      ...this.responses.filter((r) => expired(r.at)).map((r) => ({ kind: 'orphan' as const, response: r.response, responseAt: r.at })),
    ];
    this.requests = this.requests.filter((r) => !expired(r.at));
    this.responses = this.responses.filter((r) => !expired(r.at));
    return results;
  }
}

function fits(request: RtuRequestFrame, response: RtuResponseFrame): boolean {
  return request.unit === response.unit && response.byteCount === request.quantity * 2;
}
