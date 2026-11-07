import { useTranslation } from 'react-i18next';
import { num, withUnit } from '../i18n/format';
import { DEFAULT_WIRING_DAYS, WIRING_CURRENTS_A } from './constants';
import type { BmsWiring } from './types';

/**
 * How the inverter reads the battery voltage compared with the BMS: path resistance, offset, what that means while discharging, and the trend by week.
 */
export default function BmsWiringPanel({ wiring, cutoffV }: { wiring: BmsWiring; cutoffV: number | null }) {
  const { t } = useTranslation();
  const card = 'rounded-xl border border-line bg-surface p-4 sm:p-[18px]';
  const fit = wiring.overall;

  return (
    <section className={card}>
      <h2 className="text-[15px] font-semibold">{t('wiring.title')}</h2>
      <p className="mt-1 text-xs text-muted">{t('wiring.intro')}</p>
      {fit === null ? (
        <p role="status" className="mt-3 text-sm text-muted">{t('wiring.none')}</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div data-testid="wiring-resistance">
              <p className="text-xs text-muted">{t('wiring.resistance')}</p>
              <p className="text-lg font-semibold tabular-nums">{`${num(fit.resistanceOhm * 1000, 1)} mΩ`}</p>
              <p className="text-xs text-muted">{t('wiring.resistanceSub')}</p>
            </div>
            <div data-testid="wiring-offset">
              <p className="text-xs text-muted">{t('wiring.offset')}</p>
              <p className="text-lg font-semibold tabular-nums">{withUnit(fit.offsetV, 'V', 2)}</p>
              <p className="text-xs text-muted">{t('wiring.offsetSub')}</p>
            </div>
            <div data-testid="wiring-samples">
              <p className="text-xs text-muted">{t('wiring.samples')}</p>
              <p className="text-lg font-semibold tabular-nums">{String(fit.samples)}</p>
              <p className="text-xs text-muted">{t('wiring.samplesSub', { days: DEFAULT_WIRING_DAYS })}</p>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr>
                  <th className="py-1.5 pr-3 text-left text-xs font-medium text-muted">{t('wiring.dischargingAt')}</th>
                  {WIRING_CURRENTS_A.map((a) => (
                    <th key={a} className="px-2 py-1.5 text-right text-xs font-medium text-muted">{withUnit(a, 'A')}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-line">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">{t('wiring.readsLower')}</th>
                  {WIRING_CURRENTS_A.map((a) => (
                    <td key={a} className="px-2 py-1.5 text-right font-semibold">{withUnit(-fit.offsetV + fit.resistanceOhm * a, 'V', 2)}</td>
                  ))}
                </tr>
                {cutoffV !== null && (
                  <tr className="border-t border-line">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal">{t('wiring.cutoffAt', { cutoff: withUnit(cutoffV, 'V', 1) })}</th>
                    {WIRING_CURRENTS_A.map((a) => (
                      <td key={a} className="px-2 py-1.5 text-right font-semibold">{withUnit(cutoffV - fit.offsetV + fit.resistanceOhm * a, 'V', 2)}</td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {wiring.weeks.length > 0 && (
            <>
              <h3 className="mt-4 mb-1 text-xs font-medium text-muted">{t('wiring.weeks')}</h3>
              <ul aria-label={t('wiring.weeks')} className="text-sm">
                {wiring.weeks.map((w) => (
                  <li key={w.from} className="flex justify-between gap-3 border-t border-line py-1.5 first:border-t-0">
                    <span>{t('wiring.weekFrom', { date: new Date(w.from).toLocaleDateString() })}</span>
                    <span className="tabular-nums">{`${num(w.fit.resistanceOhm * 1000, 1)} mΩ · ${withUnit(w.fit.offsetV, 'V', 2)} · ${w.fit.samples}`}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
