import { useAuth } from '../auth/useAuth';
import { useTranslation } from 'react-i18next';
import HouseholdMembers from '../households/HouseholdMembers';

/** The households the user belongs to, and member management for the one they administer. */
export default function HouseholdPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  if (!user) {
    return (
      <p className="text-muted">{t('common.loading')}</p>
    );
  }

  const adminHouseholdId = user.adminHouseholdId;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="text-[15px] font-semibold">{t('household.yours')}</h2>
        <ul className="mt-3 divide-y divide-line">
          {user.households.map((household) => (
            <li key={household.id} aria-label={household.name} className="flex items-center justify-between py-2">
              <span>{household.name}</span>
              <span className="text-sm text-muted">{t(`roles.${household.role}`)}</span>
            </li>
          ))}
        </ul>
      </section>

      {adminHouseholdId !== null && <HouseholdMembers householdId={adminHouseholdId} currentUserId={user.id} />}
    </div>
  );
}
