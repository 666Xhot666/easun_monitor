import { formatGap } from './formatGap';

export interface FieldMatch { field: string; value: number; scale: number; exact: boolean; digits: number; stable: boolean }
export interface NameSuggestion { address: number; raw: number; at: number; gapMs: number; matches: FieldMatch[]; zeroMatches?: number }

/** Suggested reference fields for one unknown address; leads to check, not facts. */
export default function NameSuggestions({ suggestion }: { suggestion: NameSuggestion }) {
  const { zeroMatches, matches, gapMs } = suggestion;
  const fontMedium = 'font-medium';

  return (
    <div className="text-xs">
      {zeroMatches !== undefined ? (
        <p>0 matches {zeroMatches} reference fields</p>
      ) : matches.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">no matching reference field</p>
      ) : (
        <>
          <ul className="space-y-0.5">
            {matches.slice(0, 3).map((match, index) => (
              <li
                key={`${match.field}-${index}`}
                className={match.exact && match.stable ? fontMedium : undefined}
              >
                {`${match.field} ${match.exact ? '=' : '≈'} ${match.value}` +
                  (match.scale !== 1 ? ` (×${match.scale})` : '') +
                  (match.stable ? '' : ' · changes fast')}
              </li>
            ))}
          </ul>
          {matches.length > 3 ? <p>+{matches.length - 3} more</p> : null}
        </>
      )}
      {zeroMatches === undefined ? (
        <p className="mt-0.5 text-gray-500 dark:text-gray-400">{formatGap(gapMs)}</p>
      ) : null}
    </div>
  );
}
