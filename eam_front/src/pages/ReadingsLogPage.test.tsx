import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer } from '../test/fakeServer';
import type { RegisterDefinition } from '../inverter/types';
import ReadingsLogPage from './ReadingsLogPage';

const registers: RegisterDefinition[] = [
  { name: 'PVPower', label: 'PV power', address: 223, type: 'int16', unit: 'W', group: 'telemetry' },
  { name: 'OutputPriority', label: 'Output priority', address: 301, type: 'uint16', group: 'settings', writable: true, options: ['UTI', 'SOL', 'SBU'] },
];

describe('ReadingsLogPage', () => {
  let restore = () => {};
  afterEach(() => restore());

  it("shows the inverter's readings with their names, and the export", async () => {
    restore = fakeServer((config) =>
      config.url === '/api/inverter/registers'
        ? { status: 200, data: registers }
        : config.url === '/api/inverter/7/readings'
          ? { status: 200, data: [{ id: 1, timestamp: new Date().toISOString(), payload: { PVPower: 278 } }] }
          : { status: 404 },
    ).restore;

    render(
      <MemoryRouter initialEntries={['/dashboard/7/logs']}>
        <Routes>
          <Route path="/dashboard/:profileId/logs" element={<ReadingsLogPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'History' })).toBeInTheDocument();
    expect(await screen.findByText('278 W')).toBeInTheDocument();
    expect(screen.getByText('PV power')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
  });
});
