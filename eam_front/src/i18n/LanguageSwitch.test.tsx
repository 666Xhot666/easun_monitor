import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTranslation } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/context';
import { fakeServer } from '../test/fakeServer';
import LanguageSwitch from './LanguageSwitch';

function Overview() {
  const { t } = useTranslation();
  return <p>{t('nav.overview')}</p>;
}

function renderSwitch(signedIn: boolean) {
  const server = fakeServer(() => ({ status: 204 }));
  const auth = {
    user: signedIn ? { id: 1, email: 'a@example.com', language: null } : null,
    refreshUser: vi.fn(() => Promise.resolve()),
  } as unknown as AuthContextValue;
  render(
    <AuthContext.Provider value={auth}>
      <LanguageSwitch />
      <Overview />
    </AuthContext.Provider>,
  );
  return { server, auth };
}

describe('LanguageSwitch', () => {
  let restore = () => {};
  afterEach(() => {
    restore();
    localStorage.clear();
  });

  it('switches the app to Ukrainian at once and keeps it on the account', async () => {
    const { server, auth } = renderSwitch(true);
    restore = server.restore;
    expect(screen.getByText('Overview')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Українська' }));

    expect(await screen.findByText('Огляд')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('uk');
    expect(localStorage.getItem('eam.language')).toBe('uk');
    const put = server.sent.find((c) => c.method === 'put');
    expect(put?.url).toBe('/api/auth/language');
    expect(JSON.parse(put?.data)).toEqual({ language: 'uk' });
    expect(auth.refreshUser).toHaveBeenCalled();
  });

  it('keeps the choice in this browser only before signing in', async () => {
    const { server } = renderSwitch(false);
    restore = server.restore;
    await userEvent.click(screen.getByRole('radio', { name: 'Українська' }));
    expect(await screen.findByText('Огляд')).toBeInTheDocument();
    expect(localStorage.getItem('eam.language')).toBe('uk');
    expect(server.sent).toEqual([]);
  });

  it('offers English and Ukrainian only', () => {
    restore = renderSwitch(false).server.restore;
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['English', 'Українська']);
  });
});
