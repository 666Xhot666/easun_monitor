import { useTranslation } from 'react-i18next';
import { num, withUnit } from '../i18n/format';
import groups from './settingsGroups.json';
import type { BmsSettingsReport } from './types';

type Field = { name: string; unit: string; decimals?: number };

const GROUPS = groups.groups as { id: string; fields: Field[] }[];

/**
 * The BMS's own settings as it last reported them; read-only.
 */
export default function BmsSettingsPanel({ report }: { report: BmsSettingsReport | null }) {
  const { t } = useTranslation();
  const card = 'rounded-xl border border-line bg-surface p-4 sm:p-[18px]';

  if (report === null) {
    return (
      <section className={card}>
        <h2 className="text-[15px] font-semibold">{t('bmsSettings.title')}</h2>
        <p role="status" className="mt-2 text-sm text-muted">{t('bmsSettings.none')}</p>
      </section>
    );
  }

  function format(field: Field, value: number | boolean): string {
    if (field.unit === 'flag') {
      return value ? t('battery.on') : t('battery.off');
    }
    if (field.unit === 'count') {
      return String(value);
    }
    if (field.unit === '°C') {
      return `${num(value as number, field.decimals ?? 0)} °C`;
    }
    return withUnit(value as number, field.unit as 'V' | 'A' | 's' | 'Ah', field.decimals ?? 0);
  }

  const known = new Set(GROUPS.flatMap((g) => g.fields.map((f) => f.name)));
  const extra = Object.keys(report.settings).filter((name) => !known.has(name));

  return (
    <section className={card}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-[15px] font-semibold">{t('bmsSettings.title')}</h2>
        <span className="ml-auto text-xs text-muted">
          {t('bmsSettings.received', { time: new Date(report.receivedAt).toLocaleString() })}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">{t('bmsSettings.readOnly')}</p>
      <div className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {GROUPS.map((group) => {
          const present = group.fields.filter((field) => field.name in report.settings);
          if (present.length === 0) {
            return null;
          }
          return (
            <div key={group.id}>
              <h3 className="mb-1 text-xs font-medium text-muted">
                {t(`bmsSettings.groups.${group.id}`)}
              </h3>
              {present.map((field) => (
                <div
                  key={field.name}
                  className="flex justify-between gap-3 border-t border-line py-1.5 text-sm first-of-type:border-t-0"
                >
                  <span>{t(`bmsSettings.labels.${field.name}`)}</span>
                  <span className="font-semibold tabular-nums">
                    {format(field, report.settings[field.name])}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
        {extra.length > 0 && (
          <div>
            {extra.map((name) => (
              <div
                key={name}
                className="flex justify-between gap-3 border-t border-line py-1.5 text-sm first-of-type:border-t-0"
              >
                <span>{name}</span>
                <span className="font-semibold tabular-nums">{String(report.settings[name])}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
