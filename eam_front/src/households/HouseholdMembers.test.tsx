import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, type Reply } from '../test/fakeServer';
import HouseholdMembers from './HouseholdMembers';

const members = [
  { userId: 1, email: 'admin@example.com', role: 'ADMIN', createdAt: '2026-10-01T10:00:00.000Z' },
  { userId: 2, email: 'reader@example.com', role: 'READER', createdAt: '2026-10-05T10:00:00.000Z' },
];
const invites = [{ id: 9, role: 'READER', expiresAt: '2026-10-13T10:00:00.000Z', createdAt: '2026-10-06T10:00:00.000Z' }];

function renderMembers(handler: (method: string, url: string, body: unknown) => Reply, currentUserId = 1) {
  const server = fakeServer((config) =>
    handler(config.method ?? 'get', config.url ?? '', config.data ? JSON.parse(config.data) : undefined),
  );
  render(<HouseholdMembers householdId={5} currentUserId={currentUserId} />);
  return server;
}

const lists = (method: string, url: string): Reply | null =>
  method === 'get' && url === '/api/households/5/members'
    ? { status: 200, data: members }
    : method === 'get' && url === '/api/households/5/invites'
      ? { status: 200, data: invites }
      : null;

describe('HouseholdMembers', () => {
  let restore = () => {};
  beforeEach(() => vi.spyOn(window, 'confirm').mockReturnValue(true));
  afterEach(() => {
    restore();
    vi.restoreAllMocks();
  });

  it('lists the members with their roles, and the open invites', async () => {
    restore = renderMembers((m, u) => lists(m, u) ?? { status: 404 }).restore;

    const reader = await screen.findByRole('listitem', { name: 'reader@example.com' });
    expect(within(reader).getByLabelText('Role of reader@example.com')).toHaveValue('READER');
    const admin = screen.getByRole('listitem', { name: 'admin@example.com' });
    expect(admin).toHaveTextContent('You');
    expect(within(admin).queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Invite 9' })).toHaveTextContent('Reader');
  });

  it("changes a member's role", async () => {
    const server = renderMembers((m, u) => lists(m, u) ?? { status: 200, data: { ...members[1], role: 'ADMIN' } });
    restore = server.restore;

    await userEvent.selectOptions(await screen.findByLabelText('Role of reader@example.com'), 'ADMIN');

    const patch = server.sent.find((c) => c.method === 'patch');
    expect(patch?.url).toBe('/api/households/5/members/2');
    expect(JSON.parse(patch?.data)).toEqual({ role: 'ADMIN' });
  });

  it('removes a member after confirming', async () => {
    const server = renderMembers((m, u) => lists(m, u) ?? { status: 200, data: { success: true } });
    restore = server.restore;

    await userEvent.click(await screen.findByRole('button', { name: 'Remove reader@example.com' }));

    expect(window.confirm).toHaveBeenCalledWith('Remove reader@example.com from the household?');
    expect(server.sent.find((c) => c.method === 'delete')?.url).toBe('/api/households/5/members/2');
  });

  it('creates an invite and shows its code and link once', async () => {
    const server = renderMembers(
      (m, u) => lists(m, u) ?? { status: 201, data: { invite: { id: 10, role: 'ADMIN', expiresAt: '2026-10-13T10:00:00.000Z' }, code: 'K7Q2-9XPA' } },
    );
    restore = server.restore;

    await userEvent.selectOptions(await screen.findByLabelText('Invite as'), 'ADMIN');
    await userEvent.click(screen.getByRole('button', { name: 'Create invite' }));

    const post = server.sent.find((c) => c.method === 'post');
    expect(post?.url).toBe('/api/households/5/invites');
    expect(JSON.parse(post?.data)).toEqual({ role: 'ADMIN' });
    const shown = await screen.findByRole('region', { name: 'New invite' });
    expect(shown).toHaveTextContent('K7Q2-9XPA');
    expect(shown).toHaveTextContent(`${window.location.origin}/join/K7Q2-9XPA`);
    expect(shown).toHaveTextContent('shown only once');

    await userEvent.click(within(shown).getByRole('button', { name: 'Done' }));
    expect(screen.queryByText(/K7Q2-9XPA/)).not.toBeInTheDocument();
  });

  it('revokes an open invite', async () => {
    const server = renderMembers((m, u) => lists(m, u) ?? { status: 200, data: { success: true } });
    restore = server.restore;

    await userEvent.click(await screen.findByRole('button', { name: 'Revoke invite 9' }));

    expect(server.sent.find((c) => c.method === 'delete')?.url).toBe('/api/households/5/invites/9');
  });

  it("shows the server's reason when a change is refused", async () => {
    restore = renderMembers(
      (m, u) => lists(m, u) ?? { status: 409, data: { statusCode: 409, message: 'A household needs at least one admin' } },
    ).restore;

    await userEvent.selectOptions(await screen.findByLabelText('Role of reader@example.com'), 'ADMIN');

    expect(await screen.findByRole('alert')).toHaveTextContent('A household needs at least one admin');
  });
});
