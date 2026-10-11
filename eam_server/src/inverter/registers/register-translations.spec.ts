import { SMG_II_PANEL_SETTINGS } from './smg-ii.panel-settings';
import { SMG_II_REGISTERS } from './smg-ii.registers';
import {
  translatePanelSettings,
  translateRegisters,
} from './register-translations';

const UNIDENTIFIED =
  'Seen on the device, not yet identified. Read and stored; never written.';

describe('register translations', () => {
  const uk = translateRegisters(SMG_II_REGISTERS, 'uk');

  it('leaves English as it is', () => {
    expect(translateRegisters(SMG_II_REGISTERS, 'en')).toBe(SMG_II_REGISTERS);
    expect(translatePanelSettings(SMG_II_PANEL_SETTINGS, 'en')).toBe(
      SMG_II_PANEL_SETTINGS,
    );
  });

  it('gives every register its Ukrainian texts, shaped like the English', () => {
    SMG_II_REGISTERS.forEach((en, i) => {
      const ua = uk[i];
      const where = `${en.name}`;
      expect({ where, same: ua.label === en.label }).toEqual({
        where,
        same: false,
      });
      for (const key of ['description', 'risk'] as const) {
        expect({ where, key, has: Boolean(ua[key]) }).toEqual({
          where,
          key,
          has: Boolean(en[key]),
        });
        if (en[key])
          expect({ where, key, same: ua[key] === en[key] }).toEqual({
            where,
            key,
            same: false,
          });
      }
      expect({ where, n: ua.options?.length }).toEqual({
        where,
        n: en.options?.length,
      });
      expect({ where, n: ua.optionDescriptions?.length }).toEqual({
        where,
        n: en.optionDescriptions?.length,
      });
      expect({ where, bits: Object.keys(ua.bits ?? {}) }).toEqual({
        where,
        bits: Object.keys(en.bits ?? {}),
      });
      expect({
        ...ua,
        label: '',
        description: '',
        risk: '',
        options: [],
        optionDescriptions: [],
        bits: {},
      }).toEqual({
        ...en,
        label: '',
        description: '',
        risk: '',
        options: [],
        optionDescriptions: [],
        bits: {},
      });
    });
  });

  it('names an unidentified register by its address', () => {
    const at = SMG_II_REGISTERS.findIndex(
      (r) => r.verified === false && r.description === UNIDENTIFIED,
    );
    expect(uk[at].label).toBe(`Неперевірений ${SMG_II_REGISTERS[at].address}`);
  });

  it('translates the Ukrainian fault names', () => {
    const faults = uk.find((r) => r.name === 'FaultCode');
    expect(faults?.bits?.[3]).toBe('Перенапруга акумулятора');
  });

  it('gives every panel setting its Ukrainian texts', () => {
    const ua = translatePanelSettings(SMG_II_PANEL_SETTINGS, 'uk');
    SMG_II_PANEL_SETTINGS.forEach((en, i) => {
      const where = en.program;
      expect({ where, same: ua[i].title === en.title }).toEqual({
        where,
        same: false,
      });
      expect({ where, same: ua[i].description === en.description }).toEqual({
        where,
        same: false,
      });
      expect({ where, n: ua[i].options?.length }).toEqual({
        where,
        n: en.options?.length,
      });
      expect({ where, affects: ua[i].affects }).toEqual({
        where,
        affects: en.affects,
      });
      if (en.options) {
        expect(ua[i].options?.[en.options.indexOf(en.default)]).toBe(
          ua[i].default,
        );
      }
    });
  });
});
