import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { useEffect, useState, type ChangeEvent } from 'react';

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

    if (!window.confirm(`Remove ${member.email} from the household?`)) {
      return;
    }

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

  const handleRoleChange = (member: Member, event: ChangeEvent<HTMLSelectElement>) => {
    void changeRole(member, event.target.value as Role);
  };

  const handleInviteRoleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setError(null);
    setInviteRole(event.target.value as Role);
  };

  const handleCreateInvite = () => {
    void createInvite();
  };

  const hideNewInvite = () => {
    setError(null);
    setNewInvite(null);
  };

  return (
    <div className="space-y-8">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        >
          {error}
        </p>
      )}

      <section
        aria-label="Members"
        className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900"
      >
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Members</h2>
        <ul className="mt-3 space-y-2">
          {members.map((member) => {
            const isCurrentUser = member.userId === currentUserId;

            return (
              <li
                key={member.userId}
                aria-label={member.email}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-200 bg-gray-100 px-3 py-2 dark:border-gray-800 dark:bg-gray-950"
              >
                <span className="text-sm text-gray-900 dark:text-gray-100">
                  {member.email}
                  {isCurrentUser && (
                    <span className="ml-2 text-xs font-medium text-gray-500 dark:text-gray-400">You</span>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <select
                    aria-label={`Role of ${member.email}`}
                    value={member.role}
                    disabled={isCurrentUser}
                    onChange={(event) => handleRoleChange(member, event)}
                    className="rounded-md border border-gray-300 bg-gray-100 px-2 py-1 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  >
                    <option value="ADMIN">Admin</option>
                    <option value="READER">Reader</option>
                  </select>
                  {!isCurrentUser && (
                    <button
                      type="button"
                      aria-label={`Remove ${member.email}`}
                      onClick={() => void removeMember(member)}
                      className="rounded-md border border-gray-300 bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            );
          })}
          {members.length === 0 && (
            <li className="rounded-md border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
              No members.
            </li>
          )}
        </ul>
      </section>

      <section
        aria-label="Invites"
        className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900"
      >
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Invites</h2>
        <ul className="mt-3 space-y-2">
          {invites.map((invite) => (
            <li
              key={invite.id}
              aria-label={`Invite ${invite.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-200 bg-gray-100 px-3 py-2 dark:border-gray-800 dark:bg-gray-950"
            >
              <span className="text-sm text-gray-900 dark:text-gray-100">
                {roleLabel(invite.role)} · expires {new Date(invite.expiresAt).toLocaleDateString()}
              </span>
              <button
                type="button"
                aria-label={`Revoke invite ${invite.id}`}
                onClick={() => void revokeInvite(invite)}
                className="rounded-md border border-gray-300 bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Revoke
              </button>
            </li>
          ))}
          {invites.length === 0 && (
            <li className="rounded-md border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
              No open invites.
            </li>
          )}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            aria-label="Invite as"
            value={inviteRole}
            onChange={handleInviteRoleChange}
            className="rounded-md border border-gray-300 bg-gray-100 px-2 py-1 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="READER">Reader</option>
            <option value="ADMIN">Admin</option>
          </select>
          <button
            type="button"
            onClick={handleCreateInvite}
            className="rounded-md bg-gray-900 px-3 py-1 text-sm font-medium text-gray-100 hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
          >
            Create invite
          </button>
        </div>
      </section>

      {newInvite && (
        <section
          aria-label="New invite"
          className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900"
        >
          <p className="text-sm text-gray-900 dark:text-gray-100">
            Share this code or link. It is shown only once and expires in 7 days.
          </p>
          <code className="mt-2 block rounded-md bg-gray-100 px-3 py-2 font-mono text-sm text-gray-900 dark:bg-gray-800 dark:text-gray-100">
            {newInvite.code}
          </code>
          <p className="mt-2 break-all text-sm text-gray-700 dark:text-gray-300">
            {`${window.location.origin}/join/${newInvite.code}`}
          </p>
          <button
            type="button"
            onClick={hideNewInvite}
            className="mt-3 rounded-md bg-gray-900 px-3 py-1 text-sm font-medium text-gray-100 hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
          >
            Done
          </button>
        </section>
      )}
    </div>
  );
}
