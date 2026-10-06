import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, type Reply } from '../test/fakeServer';
import ReadingsExport from './ReadingsExport';
import { daysRange } from './days';

const TODAY = '2026-10-06';

function renderExport(handler: (config: InternalAxiosRequestConfig) => Reply) {
  const server = fakeServer((config) =>
    config.url === '/api/inverter/7/readings/export' ? handler(config) : { status: 404 },
  );
  render(<ReadingsExport profileId={7} today={TODAY} />);
  return server;
}

async function setRange(first: string, last: string) {
  await userEvent.clear(screen.getByLabelText('From'));
  await userEvent.type(screen.getByLabelText('From'), first);
  await userEvent.clear(screen.getByLabelText('To'));
  await userEvent.type(screen.getByLabelText('To'), last);
}

describe('ReadingsExport', () => {
  let restore = () => {};
  let saved: { name: string; href: string }[];

  beforeEach(() => {
    saved = [];
    URL.createObjectURL = vi.fn(() => 'blob:csv');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ name: this.download, href: this.href });
    });
  });
  afterEach(() => {
    restore();
    vi.restoreAllMocks();
  });

  it('downloads the chosen days as a CSV file, in the browser time zone', async () => {
    const server = renderExport(() => ({ status: 200, data: new Blob(['Time,PV power (W)\r\n']) }));
    restore = server.restore;

    await setRange('2026-10-01', '2026-10-05');
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    await vi.waitFor(() => expect(saved).toEqual([{ name: 'readings-2026-10-01-to-2026-10-05.csv', href: 'blob:csv' }]));
    expect(server.sent[0].params).toEqual({
      ...daysRange('2026-10-01', '2026-10-05'),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect(server.sent[0].responseType).toBe('blob');
  });

  it('starts with today as the whole range', () => {
    restore = renderExport(() => ({ status: 200, data: new Blob() })).restore;

    expect(screen.getByLabelText('From')).toHaveValue(TODAY);
    expect(screen.getByLabelText('To')).toHaveValue(TODAY);
  });

  it('refuses a backwards range or one over 31 days without asking the server', async () => {
    const server = renderExport(() => ({ status: 200, data: new Blob() }));
    restore = server.restore;

    await setRange('2026-10-05', '2026-10-01');
    expect(screen.getByRole('alert')).toHaveTextContent('Start on or before the end day.');
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();

    await setRange('2026-09-01', '2026-10-02');
    expect(screen.getByRole('alert')).toHaveTextContent('Export at most 31 days at a time.');
    expect(server.sent).toHaveLength(0);
  });

  it("says so when the export fails", async () => {
    restore = renderExport(() => ({ status: 500 })).restore;

    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't export the readings.");
    expect(saved).toEqual([]);
  });
});
