import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import HouseholdMembers from '../households/HouseholdMembers';
import TelegramLink from '../telegram/TelegramLink';

/**
 * Household page.
 */
export default function HouseholdPage() {
  const { profileId = '' } = useParams();
  const { user } = useAuth();

  if (!user) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8 text-gray-900 dark:text-gray-100">
        Loading…
      </main>
    );
  }

  const adminHouseholdId = user.adminHouseholdId;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <header className="mx-auto max-w-4xl px-4 pt-6">
        <Link
          to={`/dashboard/${profileId}`}
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Household</h1>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <section className="rounded-lg border border-gray-200 bg-gray-100 p-4 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-lg font-medium">Your households</h2>
          <ul className="mt-3 divide-y divide-gray-200 dark:divide-gray-700">
            {user.households.map((household) => (
              <li
                key={household.id}
                aria-label={household.name}
                className="flex items-center justify-between py-2"
              >
                <span>{household.name}</span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {household.role === 'ADMIN' ? 'Admin' : 'Reader'}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {adminHouseholdId !== null && (
          <section className="mt-6 rounded-lg border border-gray-200 bg-gray-100 p-4 dark:border-gray-700 dark:bg-gray-800">
            <h2 className="text-lg font-medium">Members and invites</h2>
            <HouseholdMembers householdId={adminHouseholdId} currentUserId={user.id} />
          </section>
        )}

        <TelegramLink />
      </main>
    </div>
  );
}
