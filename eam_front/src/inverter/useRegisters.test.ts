import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { fakeServer } from '../test/fakeServer';
import { useRegisters } from './useRegisters';

const LABELS: Record<string, string> = { en: 'Mains voltage', uk: 'Напруга мережі' };

describe('useRegisters', () => {
  const server = fakeServer((config) => ({
    status: 200,
    data: [{ name: 'MainsVoltage', label: LABELS[config.params.lang], address: 202, type: 'int16', group: 'telemetry' }],
  }));
  afterEach(() => server.restore());

  it('asks for the register texts in the current language, and again when it changes', async () => {
    const { result } = renderHook(() => useRegisters());
    await waitFor(() => expect(result.current?.[0].label).toBe('Mains voltage'));

    await act(() => i18n.changeLanguage('uk'));
    await waitFor(() => expect(result.current?.[0].label).toBe('Напруга мережі'));
    expect(server.sent.map((c) => c.params)).toEqual([{ lang: 'en' }, { lang: 'uk' }]);
  });
});
