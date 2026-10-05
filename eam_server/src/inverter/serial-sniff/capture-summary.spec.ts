import { RegisterMap } from '../registers/register-map';
import { SMG_II_REGISTERS } from '../registers/smg-ii.registers';
import { observePair, summarizeCapture, type CaptureRecord } from './capture-summary';

const map = new RegisterMap(SMG_II_REGISTERS);
const read = (address: number, words: number[]) => ({
  request: { unit: 1, func: 3, address, quantity: words.length, hex: '' },
  response: { unit: 1, func: 3, byteCount: words.length * 2, words, hex: '' },
});
const bounds24 = { MaxChargingVoltage: { min: 24, max: 30, context: 'for a 24 V battery' } };

describe('observePair', () => {
  it('names each register in a read and checks its value', () => {
    expect(observePair(map, read(301, [3, 9]))).toEqual([
      { address: 301, name: 'OutputPriority', value: 3, category: 'plausible' },
      { address: 302, name: 'InputVoltageRange', value: 9, category: 'implausible', reason: 'not one of its 3 options' },
    ]);
  });

  it('scales values and checks them against the battery ranges too', () => {
    expect(observePair(map, read(324, [560]), bounds24)).toEqual([
      { address: 324, name: 'MaxChargingVoltage', value: 56, category: 'implausible', reason: 'outside 24-30 for a 24 V battery' },
    ]);
    expect(observePair(map, read(320, [2300]))[0]).toMatchObject({ value: 230, category: 'plausible' });
    expect(observePair(map, read(320, [2310]))[0]).toMatchObject({ category: 'implausible', reason: 'not one of 220, 230, 240' });
  });

  it('reports addresses the register map does not know, with the raw word', () => {
    expect(observePair(map, read(343, [20, 7]))).toEqual([
      { address: 343, name: 'OffGridSocProtection', value: 20, category: 'plausible' },
      { address: 344, name: null, value: 7, category: 'unknown' },
    ]);
  });
});

describe('observePair with unverified registers', () => {
  const withUnverified = new RegisterMap([
    { name: 'Known', label: 'Known', address: 500, type: 'uint16', group: 'settings' },
    { name: 'Unverified501', label: 'Unverified 501', address: 501, type: 'uint16', group: 'settings', verified: false },
  ]);

  it('reports registers that are mapped but not yet identified as unverified', () => {
    expect(observePair(withUnverified, read(500, [1, 7, 9]))).toEqual([
      { address: 500, name: 'Known', value: 1, category: 'plausible' },
      { address: 501, name: 'Unverified501', value: 7, category: 'unverified' },
      { address: 502, name: null, value: 9, category: 'unknown' },
    ]);
  });

  it('counts them separately in a summary', () => {
    const summary = summarizeCapture(withUnverified, [{ seq: 1, kind: 'pair', requestAt: 1, responseAt: 2, ...read(500, [1, 7, 9]) }]);
    expect(summary.counts).toMatchObject({ plausible: 1, unverified: 1, unknown: 1 });
  });
});

describe('summarizeCapture', () => {
  const records: CaptureRecord[] = [
    { seq: 1, kind: 'pair', requestAt: 1000, responseAt: 1040, ...read(301, [2]) },
    { seq: 2, kind: 'pair', requestAt: 2000, responseAt: 2040, ...read(301, [9]) },
    { seq: 3, kind: 'pair', requestAt: 3000, responseAt: 3040, ...read(301, [3]) },
    { seq: 4, kind: 'pair', requestAt: 4000, responseAt: 4040, ...read(344, [7]) },
    { seq: 5, kind: 'unanswered', requestAt: 5000, request: read(322, [0]).request },
    { seq: 6, kind: 'orphan', responseAt: 6000, response: read(1, [1, 2]).response },
    { seq: 7, kind: 'port', at: 7000, port: 'tx', state: 'reconnecting', message: 'device reports readiness to read but returned no data' },
  ];

  it('lists each address once, latest value first, and keeps an implausible value visible', () => {
    expect(summarizeCapture(map, records).addresses).toEqual([
      { address: 301, name: 'OutputPriority', latestValue: 3, category: 'implausible', reason: 'not one of its 4 options', seen: 3, lastSeenAt: 3040 },
      { address: 344, name: null, latestValue: 7, category: 'unknown', seen: 1, lastSeenAt: 4040 },
    ]);
  });

  it('counts addresses by category, plus unanswered requests and orphan responses', () => {
    const summary = summarizeCapture(map, records);
    expect(summary.counts).toEqual({ pairs: 4, plausible: 0, implausible: 1, unverified: 0, unknown: 1, unanswered: 1, orphan: 1, reconnects: 1 });
    expect(summary.unanswered).toEqual([{ address: 322, quantity: 1, count: 1 }]);
  });
});
