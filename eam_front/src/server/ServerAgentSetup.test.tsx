import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer } from '../test/fakeServer';
import ServerAgentSetup from './ServerAgentSetup';
import type { ServerStatus } from './types';

const NOW = Date.parse('2026-10-11T10:00:00Z');

function renderSetup(status: ServerStatus) {
  const server = fakeServer((config) =>
    config.method === 'post' ? { status: 201, data: { token: 'tok_agent' } } : { status: 200, data: status },
  );
  render(<ServerAgentSetup now={() => NOW} />);
  return server;
}

describe('ServerAgentSetup', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('makes the first agent token and shows the agent settings once', async () => {
    const server = renderSetup({ agent: { configured: false, lastSeenAt: null }, sample: null, stale: true });
    restore = server.restore;

    expect(await screen.findByText('Not set up yet.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Make agent token' }));

    expect(server.sent.find((c) => c.method === 'post')?.url).toBe('/api/server/agent/token');
    const shown = await screen.findByRole('region', { name: 'Agent settings' });
    expect(shown).toHaveTextContent(`SERVER_AGENT_URL=${window.location.origin}`);
    expect(shown).toHaveTextContent('SERVER_AGENT_TOKEN=tok_agent');
    expect(shown).toHaveTextContent('shown only once');
    await userEvent.click(within(shown).getByRole('button', { name: 'Done' }));
    expect(screen.queryByText(/tok_agent/)).not.toBeInTheDocument();
  });

  it('says when the agent last reported, and asks before replacing its token', async () => {
    const server = renderSetup({
      agent: { configured: true, lastSeenAt: new Date(NOW - 40_000).toISOString() },
      sample: null,
      stale: false,
    });
    restore = server.restore;

    expect(await screen.findByText('Last report 40 s ago')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New agent token' }));
    expect(server.sent.some((c) => c.method === 'post')).toBe(false);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Make a new token' }));
    expect(await screen.findByRole('region', { name: 'Agent settings' })).toHaveTextContent('SERVER_AGENT_TOKEN=tok_agent');
  });
});
