import { RequestResponsePairer } from './request-response-pairer';
import type { RtuRequestFrame } from './rtu-request-parser';
import type { RtuResponseFrame } from './rtu-response-parser';

const request = (address: number, quantity: number): RtuRequestFrame => ({
  unit: 1, func: 3, address, quantity, hex: `req ${address}`,
});
const response = (words: number[]): RtuResponseFrame => ({
  unit: 1, func: 3, byteCount: words.length * 2, words, hex: `res ${words.join(',')}`,
});

describe('RequestResponsePairer', () => {
  it('pairs a request with the response that follows it', () => {
    const pairer = new RequestResponsePairer({ windowMs: 1000 });
    expect(pairer.push({ dir: 'tx', at: 0, request: request(301, 1) })).toEqual([]);
    expect(pairer.push({ dir: 'rx', at: 40, response: response([2]) })).toEqual([
      { kind: 'pair', request: request(301, 1), requestAt: 0, response: response([2]), responseAt: 40 },
    ]);
  });

  it('still pairs when the request tap reports later than the response tap', () => {
    const pairer = new RequestResponsePairer({ windowMs: 1000 });
    expect(pairer.push({ dir: 'rx', at: 40, response: response([2]) })).toEqual([]);
    expect(pairer.push({ dir: 'tx', at: 90, request: request(301, 1) })).toEqual([
      expect.objectContaining({ kind: 'pair', requestAt: 90, responseAt: 40 }),
    ]);
  });

  it('pairs consecutive requests with their responses in order', () => {
    const pairer = new RequestResponsePairer({ windowMs: 1000 });
    pairer.push({ dir: 'tx', at: 0, request: request(301, 1) });
    pairer.push({ dir: 'tx', at: 10, request: request(302, 1) });
    const pairs = [
      ...pairer.push({ dir: 'rx', at: 50, response: response([2]) }),
      ...pairer.push({ dir: 'rx', at: 60, response: response([1]) }),
    ];
    expect(pairs.map((p) => p.kind === 'pair' && [p.request.address, p.response.words[0]])).toEqual([
      [301, 2],
      [302, 1],
    ]);
  });

  it('never pairs a response whose size does not fit the request', () => {
    const pairer = new RequestResponsePairer({ windowMs: 1000 });
    pairer.push({ dir: 'tx', at: 0, request: request(322, 22) });
    expect(pairer.push({ dir: 'rx', at: 40, response: response([1, 2]) })).toEqual([]);
    expect(pairer.flush(2000)).toEqual([
      { kind: 'unanswered', request: request(322, 22), requestAt: 0 },
      { kind: 'orphan', response: response([1, 2]), responseAt: 40 },
    ]);
  });

  it('gives up on a request or response only after the window', () => {
    const pairer = new RequestResponsePairer({ windowMs: 1000 });
    pairer.push({ dir: 'tx', at: 0, request: request(301, 1) });
    expect(pairer.flush(999)).toEqual([]);
    expect(pairer.flush(1001)).toEqual([expect.objectContaining({ kind: 'unanswered' })]);
    expect(pairer.flush(5000)).toEqual([]);
  });
});
