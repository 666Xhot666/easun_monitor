import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InternalAxiosRequestConfig } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, type Reply } from '../test/fakeServer';
import LocationForm from './LocationForm';

function renderForm(
  location: { latitude: number | null; longitude: number | null },
  handler: (config: InternalAxiosRequestConfig) => Reply = () => ({ status: 200, data: {} }),
  readOnly = false,
) {
  const onSaved = vi.fn();
  const server = fakeServer(handler);
  render(<LocationForm profileId={7} {...location} onSaved={onSaved} readOnly={readOnly} />);
  return { ...server, onSaved };
}

describe('LocationForm', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('shows the saved location', () => {
    restore = renderForm({ latitude: 12.3, longitude: -45.7 }).restore;

    expect(screen.getByLabelText('Latitude')).toHaveValue(12.3);
    expect(screen.getByLabelText('Longitude')).toHaveValue(-45.7);
  });

  it('fills in the detected location, and saves it only when asked', async () => {
    const { sent, onSaved, restore: r } = renderForm({ latitude: null, longitude: null }, (config) =>
      config.url === '/api/location/detect' ? { status: 200, data: { latitude: 12.3, longitude: -45.7 } } : { status: 200, data: {} },
    );
    restore = r;

    await userEvent.click(screen.getByRole('button', { name: 'Detect location' }));

    expect(await screen.findByDisplayValue('12.3')).toBe(screen.getByLabelText('Latitude'));
    expect(screen.getByLabelText('Longitude')).toHaveValue(-45.7);
    expect(sent).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Save location' }));

    expect(sent[1].method).toBe('patch');
    expect(sent[1].url).toBe('/api/inverter/profiles/7');
    expect(JSON.parse(sent[1].data)).toEqual({ latitude: 12.3, longitude: -45.7 });
    expect(onSaved).toHaveBeenCalled();
  });

  it('saves blanks as cleared', async () => {
    const { sent, restore: r } = renderForm({ latitude: 12.3, longitude: -45.7 });
    restore = r;

    await userEvent.clear(screen.getByLabelText('Latitude'));
    await userEvent.clear(screen.getByLabelText('Longitude'));
    await userEvent.click(screen.getByRole('button', { name: 'Save location' }));

    expect(JSON.parse(sent[0].data)).toEqual({ latitude: null, longitude: null });
  });

  it("shows the server's reason when the location can't be found", async () => {
    restore = renderForm({ latitude: null, longitude: null }, () => ({
      status: 503,
      data: { statusCode: 503, message: "Couldn't find the location. Enter it by hand." },
    })).restore;

    await userEvent.click(screen.getByRole('button', { name: 'Detect location' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't find the location. Enter it by hand.");
  });

  it('only shows the location to readers', () => {
    restore = renderForm({ latitude: 12.3, longitude: -45.7 }, undefined, true).restore;

    expect(screen.getByLabelText('Latitude')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Detect location' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save location' })).not.toBeInTheDocument();
  });
});
