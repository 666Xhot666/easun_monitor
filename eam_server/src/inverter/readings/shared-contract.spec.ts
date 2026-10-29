import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMON_READINGS, INVERTER_STATES } from './common-readings';

/** The quoted names in the union type `name` of the shared package's readings.ts. */
function sharedNames(name: string): string[] {
  const source = readFileSync(
    join(__dirname, '../../../../eam_shared/src/readings.ts'),
    'utf8',
  );
  const start = source.indexOf(`export type ${name} =`);
  const end = source.indexOf(';', start);
  return [...source.slice(start, end).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('common readings shared with the apps', () => {
  it('names the same readings and states as the apps do (eam_shared)', () => {
    expect(sharedNames('CommonReading').sort()).toEqual(
      [...COMMON_READINGS].sort(),
    );
    expect(sharedNames('InverterState').sort()).toEqual(
      [...INVERTER_STATES].sort(),
    );
  });
});
