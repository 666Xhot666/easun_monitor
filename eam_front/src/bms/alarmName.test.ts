import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { alarmName } from './alarmName';

describe('alarmName', () => {
  it('names a known alarm in the current language, an unknown one as the BMS gave it', async () => {
    expect(alarmName('Charge overcurrent')).toBe('Charge overcurrent');
    await i18n.changeLanguage('uk');
    expect(alarmName('Charge overcurrent')).toBe('Надструм заряду');
    expect(alarmName('Something new')).toBe('Something new');
  });
});
