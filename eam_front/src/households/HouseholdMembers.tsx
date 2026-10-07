import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { useEffect, useState } from 'react';
import { Button, Card, CardTitle, Segmented } from '../ui';
import { CopyButton } from '../ui/CopyButton';
import { Dialog } from '../ui/Dialog';

type Role = 'ADMIN' | 'READER';

interface Member {
  userId: number;
  email: string;
  role: Role;
  createdAt: string;
}

interface Invite {
  id: number;
  role: Role;
  expiresAt: string;
  createdAt: string;
}

interface CreatedInvite {
  invite: Pick<Invite, 'id' | 'role' | 'expiresAt'>;
  code: string;
}

interface HouseholdMembersProps {
  householdId: number;
  currentUserId: number;
}

const fallbackMessage = 'Couldn\'t update the household.';

const roleLabel = (role: Role) => (role === 'ADMIN' ? 'Admin' : 'Reader');

/**
 * Lists household members and open invites, and lets the current user manage roles, removals, and invites.
 */
export default function HouseholdMembers({ householdId, currentUserId }: HouseholdMembersProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newInvite, setNewInvite] = useState<CreatedInvite | null>(null);
  const [inviteRole, setInviteRole] = useState<Role>('READER');
  const [removing, setRemoving] = useState<Member | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [membersResponse, invitesResponse] = await Promise.all([
          axios.get<Member[]>(`/api/households/${householdId}/members`),
          axios.get<Invite[]>(`/api/households/${householdId}/invites`),
        ]);

        if (!cancelled) {
          setError(null);
          setMembers(membersResponse.data);
          setInvites(invitesResponse.data);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(extractErrorMessage(requestError, fallbackMessage));
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [householdId]);

  const reload = async () => {
    try {
      const [membersResponse, invitesResponse] = await Promise.all([
        axios.get<Member[]>(`/api/households/${householdId}/members`),
        axios.get<Invite[]>(`/api/households/${householdId}/invites`),
      ]);

      setError(null);
      setMembers(membersResponse.data);
      setInvites(invitesResponse.data);
    } catch (requestError) {
      setError(extractErrorMessage(requestError, fallbackMessage));
    }
  };

  const changeRole = async (member: Member, nextRole: Role) => {
    setError(null);

    if (nextRole === member.role) {
      return;
    }

    try {
      await axios.patch(`/api/households/${householdId}/members/${member.userId}`, { role: nextRole });
      await reload();
    } catch (requestError) {
      setError(extractErrorMessage(requestError, fallbackMessage));
    }
  };

  const removeMember = async (member: Member) => {
    setError(null);


    try {
      await axios.delete(`/api/households/${householdId}/members/${member.userId}`);
      await reload();
    } catch (requestError) {
      setError(extractErrorMessage(requestError, fallbackMessage));
    }
  };

  const revokeInvite = async (invite: Invite) => {
    setError(null);

    try {
      await axios.delete(`/api/households/${householdId}/invites/${invite.id}`);
      await reload();
    } catch (requestError) {
      setError(extractErrorMessage(requestError, fallbackMessage));
    }
  };

  const createInvite = async () => {
    setError(null);
    setNewInvite(null);

    try {
      const response = await axios.post<CreatedInvite>(`/api/households/${householdId}/invites`, {
        role: inviteRole,
      });

      setNewInvite(response.data);
      await reload();
    } catch (requestError) {
      setError(extractErrorMessage(requestError, fallbackMessage));
    }
  };



  const handleCreateInvite = () => {
    void createInvite();
  };

  const hideNewInvite = () => {
    setError(null);
    setNewInvite(null);
  };

  const joinLink = newInvite ? `${window.location.origin}/join/${newInvite.code}` : '';
  const roleOptions = [
    { value: 'ADMIN' as Role, label: 'Admin' },
    { value: 'READER' as Role, label: 'Reader' },
  ];

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-lg border border-crit-line bg-crit-bg px-3 py-2 text-sm text-crit-ink">
          {error}
        </p>
      )}

      <Card as="div">
        <section aria-label="Members">
          <CardTitle>Members</CardTitle>
          <ul className="mt-3 overflow-hidden rounded-lg border border-line">
            {members.map((member) => {
              const isCurrentUser = member.userId === currentUserId;
              return (
                <li
                  key={member.userId}
                  aria-label={member.email}
                  className="flex flex-wrap items-center gap-3 border-t border-line px-3.5 py-3 first:border-t-0"
                >
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-full border border-line-strong bg-surface-2 text-sm font-semibold">
                    {member.email.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px]">
                    {member.email}
                    {isCurrentUser && <span className="ml-2 text-xs text-muted">You</span>}
                  </span>
                  {isCurrentUser ? (
                    <span className="text-sm text-muted">{roleLabel(member.role)}</span>
                  ) : (
                    <>
                      <Segmented
                        ariaLabel={`Role of ${member.email}`}
                        size="sm"
                        options={roleOptions}
                        value={member.role}
                        onChange={(role) => void changeRole(member, role)}
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${member.email}`}
                        onClick={() => setRemoving(member)}
                        className="h-8 rounded-lg px-2.5 text-[13px] font-medium text-crit-ink hover:bg-crit-bg"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </li>
              );
            })}
            {members.length === 0 && <li className="px-3.5 py-3 text-sm text-muted">No members.</li>}
          </ul>
        </section>
      </Card>

      <Card as="div">
        <section aria-label="Invites">
          <CardTitle>Invite someone</CardTitle>
          {newInvite ? (
            <section aria-label="New invite" className="mt-3 rounded-lg bg-surface-2 p-4">
              <p className="text-sm font-semibold">
                Invite as {roleLabel(newInvite.invite.role)} · expires in 7 days
              </p>
              <p className="mt-1 text-xs text-muted">Share the link or the code. It is shown only once.</p>
              <div className="mt-3 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[13px]">{joinLink}</code>
                <CopyButton text={joinLink} label="Copy link" />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[13px]">{newInvite.code}</code>
                <CopyButton text={newInvite.code} label="Copy code" />
              </div>
              <div className="mt-3 flex gap-2">
                {typeof navigator.share === 'function' && (
                  <Button variant="primary" onClick={() => void navigator.share({ title: 'Join my EAM household', url: joinLink }).catch(() => {})}>
                    Share…
                  </Button>
                )}
                <Button onClick={hideNewInvite}>Done</Button>
              </div>
            </section>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Segmented ariaLabel="Invite as" options={[roleOptions[1], roleOptions[0]]} value={inviteRole} onChange={setInviteRole} />
              <Button variant="primary" onClick={handleCreateInvite}>
                Create invite
              </Button>
            </div>
          )}
          <p className="mt-3 text-xs text-muted">
            Readers see the Overview, Battery, History and Alerts. Admins can also change settings and invite people.
          </p>
          {invites.length > 0 && (
            <>
              <p className="mt-4 mb-2 text-xs text-muted">Open invites</p>
              <ul className="overflow-hidden rounded-lg border border-line">
                {invites.map((invite) => (
                  <li key={invite.id} aria-label={`Invite ${invite.id}`} className="flex items-center gap-3 border-t border-line px-3.5 py-2.5 text-sm first:border-t-0">
                    <span className="flex-1">
                      {roleLabel(invite.role)} · expires {new Date(invite.expiresAt).toLocaleDateString()}
                    </span>
                    <button
                      type="button"
                      aria-label={`Revoke invite ${invite.id}`}
                      onClick={() => void revokeInvite(invite)}
                      className="h-8 rounded-lg px-2.5 text-[13px] font-medium text-crit-ink hover:bg-crit-bg"
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </Card>

      <Dialog
        open={removing !== null}
        title={`Remove ${removing?.email} from the household?`}
        onClose={() => setRemoving(null)}
        actions={
          <>
            <Button onClick={() => setRemoving(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                const member = removing;
                setRemoving(null);
                if (member) void removeMember(member);
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        They lose access to this household’s inverters straight away.
      </Dialog>
    </div>
  );
}
