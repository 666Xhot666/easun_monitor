import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer, type Reply } from '../test/fakeServer';
import OutageSetup from './OutageSetup';
import type { OutageSource } from './types';

const NOW = Date.parse('2026-10-12T09:00:00Z');
const source = (over: Partial<OutageSource> = {}): OutageSource => ({
  id: 1,
  site: 'dnem',
  city: 'м. Дніпро',
  street: 'вул. Тестова',
  house: '12а',
  enabled: true,
  houseState: 'FOUND',
  groups: ['GPV5.2'],
  lastSeenAt: new Date(NOW - 5 * 60_000).toISOString(),
  ...over,
});

interface Site {
  source?: OutageSource | null;
  cities?: string[];
  streets?: Record<string, string[]>;
  put?: (body: Record<string, unknown>) => Reply;
}

function renderSetup(site: Site, readOnly = false) {
  let current = site.source ?? null;
  const server = fakeServer((config) => {
    const method = config.method ?? 'get';
    const url = config.url ?? '';
    const body = config.data ? JSON.parse(config.data) : undefined;
    if (url === '/api/outage/cities') return { status: 200, data: site.cities ?? [] };
    if (url === '/api/outage/streets') return { status: 200, data: site.streets?.[config.params.city] ?? [] };
    if (url.endsWith('/outage-source/token')) return { status: 201, data: { token: 'tok_new' } };
    if (method === 'put') {
      const reply = site.put?.(body);
      if (reply) return reply;
      const created = !current;
      current = { ...(current ?? source({ houseState: 'PENDING', groups: [], lastSeenAt: null })), ...body };
      return { status: 200, data: created ? { source: current, token: 'tok_first' } : { source: current } };
    }
    if (method === 'delete') {
      current = null;
      return { status: 204 };
    }
    return { status: 200, data: { source: current } };
  });
  render(<OutageSetup profileId={7} readOnly={readOnly} now={() => NOW} />);
  return server;
}

describe('OutageSetup', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('sets the address and shows the reader settings once', async () => {
    const server = renderSetup({ source: null });
    restore = server.restore;

    expect(await screen.findByText(/No address yet/)).toBeInTheDocument();
    // Before the reader's first run there are no lists to pick from.
    expect(await screen.findByText(/type them as the DTEK site writes them/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('City'), 'м. Дніпро');
    await userEvent.type(screen.getByLabelText('Street'), 'вул. Тестова');
    await userEvent.type(screen.getByLabelText('House'), '12а');
    await userEvent.click(screen.getByRole('button', { name: 'Save address' }));

    const put = server.sent.find((c) => c.method === 'put');
    expect(put?.url).toBe('/api/inverter/profiles/7/outage-source');
    expect(JSON.parse(put?.data)).toEqual({ city: 'м. Дніпро', street: 'вул. Тестова', house: '12а' });

    const shown = await screen.findByRole('region', { name: 'Reader settings' });
    expect(shown).toHaveTextContent(`OUTAGE_SERVER_URL=${window.location.origin}`);
    expect(shown).toHaveTextContent('OUTAGE_READER_TOKEN=tok_first');
    expect(shown).toHaveTextContent('shown only once');
    expect(screen.getByText("The reader hasn't connected yet.")).toBeInTheDocument();

    await userEvent.click(within(shown).getByRole('button', { name: 'Done' }));
    expect(screen.queryByText(/tok_first/)).not.toBeInTheDocument();
  });

  it("offers the site's cities and the chosen city's streets", async () => {
    const server = renderSetup({
      source: null,
      cities: ['м. Дніпро', 'смт Слобожанське'],
      streets: { 'м. Дніпро': ['вул. Тестова', 'просп. Яворницького'] },
    });
    restore = server.restore;

    const city = await screen.findByLabelText('City');
    await screen.findByRole('option', { name: 'смт Слобожанське', hidden: true });
    await userEvent.type(city, 'м. Дніпро');
    expect(await screen.findByRole('option', { name: 'просп. Яворницького', hidden: true })).toBeInTheDocument();
    expect(server.sent.find((c) => c.url === '/api/outage/streets')?.params).toEqual({ city: 'м. Дніпро' });
    expect(screen.queryByText(/type them as the DTEK site writes them/)).not.toBeInTheDocument();
  });

  it('shows the group the reader found and when it last asked', async () => {
    restore = renderSetup({ source: source() }).restore;
    expect(await screen.findByText('Group 5.2')).toBeInTheDocument();
    expect(screen.getByText('Reader last asked 5 min ago')).toBeInTheDocument();
    expect(screen.getByLabelText('House')).toHaveValue('12а');
  });

  it.each([
    [{ groups: ['GPV5.2', 'GPV1.1'] }, 'Groups 5.2, 1.1: the house is on several groups; the outages of all of them are shown.'],
    [{ groups: [] }, 'The site lists no outage group for this house.'],
    [{ houseState: 'NOT_FOUND' as const, groups: [] }, 'The house is not on the site for this street. Check how the site writes its number.'],
    [{ lastSeenAt: null, houseState: 'PENDING' as const, groups: [] }, "The reader hasn't connected yet."],
  ])('explains what the reader found: %o', async (over, text) => {
    restore = renderSetup({ source: source(over) }).restore;
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('switches checking off and on', async () => {
    const server = renderSetup({ source: source() });
    restore = server.restore;
    await userEvent.click(await screen.findByRole('switch', { name: 'Check the outage schedule' }));
    expect(JSON.parse(server.sent.find((c) => c.method === 'put')?.data)).toEqual({
      city: 'м. Дніпро',
      street: 'вул. Тестова',
      house: '12а',
      enabled: false,
    });
    expect(await screen.findByRole('switch', { name: 'Check the outage schedule' })).toHaveAttribute('aria-checked', 'false');
  });

  it("shows the server's reason when the address is refused", async () => {
    restore = renderSetup({
      source: source(),
      put: () => ({ status: 400, data: { message: 'вул. Нова is not on the site\'s list for м. Дніпро' } }),
    }).restore;
    const street = await screen.findByLabelText('Street');
    await userEvent.clear(street);
    await userEvent.type(street, 'вул. Нова');
    await userEvent.click(screen.getByRole('button', { name: 'Save address' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("вул. Нова is not on the site's list for м. Дніпро");
  });

  it('replaces the reader token and removes the address after confirming', async () => {
    const server = renderSetup({ source: source() });
    restore = server.restore;

    await userEvent.click(await screen.findByRole('button', { name: 'New reader token' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Make a new token' }));
    expect(await screen.findByRole('region', { name: 'Reader settings' })).toHaveTextContent('OUTAGE_READER_TOKEN=tok_new');

    await userEvent.click(screen.getByRole('button', { name: 'Remove address' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(server.sent.find((c) => c.method === 'delete')?.url).toBe('/api/inverter/profiles/7/outage-source');
    expect(await screen.findByText(/No address yet/)).toBeInTheDocument();
  });

  it('only shows the address to readers', async () => {
    restore = renderSetup({ source: source() }, true).restore;
    expect(await screen.findByText('м. Дніпро, вул. Тестова, 12а')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save address' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New reader token' })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Check the outage schedule' })).toBeDisabled();
  });
});
