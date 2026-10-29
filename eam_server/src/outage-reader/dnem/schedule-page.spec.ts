import { parseSchedulePage } from './schedule-page';
import { SiteError } from './site-error';

const PAGE_URL = 'https://www.dtek-dnem.com.ua/ua/shutdowns';

const hourly = Object.fromEntries(
  Array.from({ length: 24 }, (_, i) => {
    const from = `${String(i).padStart(2, '0')}:00`;
    const to = `${String((i + 1) % 24).padStart(2, '0')}:00`;
    const label = `${from.slice(0, 2)}-${String(i + 1).padStart(2, '0')}`;
    return [String(i + 1), [label, from, i === 23 ? '24:00' : to]];
  }),
);

/** 24 hourly slots keyed "1".."24", all `fill` unless overridden. */
const slots = (fill: string, overrides: Record<number, string> = {}) =>
  Object.fromEntries(
    Array.from({ length: 24 }, (_, i) => [
      String(i + 1),
      overrides[i + 1] ?? fill,
    ]),
  );

const week = (fill: string) =>
  Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 7].map((d) => [String(d), slots(fill)]),
  );

const preset = {
  days: { '1': 'Понеділок', '7': 'Неділя' },
  days_mini: { '1': 'Пн', '7': 'Нд' },
  sch_names: { 'GPV5.2': 'Черга 5.2' },
  time_zone: hourly,
  time_type: { yes: 'Світло є', no: 'Світла немає' },
  data: {
    'GPV5.2': {
      ...week('yes'),
      '1': slots('yes', { 9: 'maybe', 10: 'mfirst' }),
    },
  },
  updateFact: '24.07.2026 08:30',
};

const emptyFact = { data: [], update: '24.07.2026 08:30', today: 1791579600 };

interface PageParts {
  head?: string;
  streets?: unknown;
  preset?: unknown;
  fact?: unknown;
  raw?: string;
}

/** A schedule page in the site's layout: meta tags, then inline assignments. */
function page(parts: PageParts = {}): string {
  const head =
    parts.head ??
    '<meta name="ajaxUrl" content="/ua/ajax" />\n<meta name="csrf-token" content="tok-123">';
  const assign = (name: string, value: unknown) =>
    value === undefined
      ? ''
      : `DisconSchedule.${name} = ${JSON.stringify(value)}\n`;
  const scripts =
    parts.raw ??
    assign(
      'streets',
      'streets' in parts ? parts.streets : { 'м. Тестове': ['вул. Тестова'] },
    ) +
      assign('preset', 'preset' in parts ? parts.preset : preset) +
      'DisconSchedule.showCurOutage = true\n' +
      `DisconSchedule.fact = ${JSON.stringify('fact' in parts ? parts.fact : emptyFact)}`;
  return `<html><head>${head}</head><body><script type="text/javascript">\n${scripts}</script></body></html>`;
}

function errorOf(html: string): SiteError {
  try {
    parseSchedulePage(html, PAGE_URL);
  } catch (e) {
    if (e instanceof SiteError) return e;
    throw e;
  }
  throw new Error('expected a SiteError');
}

describe('parseSchedulePage', () => {
  it('resolves the AJAX address against the page and reads the CSRF token', () => {
    const parsed = parseSchedulePage(page(), PAGE_URL);
    expect(parsed.ajaxUrl).toBe('https://www.dtek-dnem.com.ua/ua/ajax');
    expect(parsed.csrfToken).toBe('tok-123');
  });

  it('keeps an absolute AJAX address, and falls back to /ua/ajax without one', () => {
    const absolute = page({
      head: '<meta name="ajaxUrl" content="https://ajax.example/ua/ajax"><meta name="csrf-token" content="t">',
    });
    expect(parseSchedulePage(absolute, PAGE_URL).ajaxUrl).toBe(
      'https://ajax.example/ua/ajax',
    );

    const missing = page({ head: '<meta name="csrf-token" content="t">' });
    expect(parseSchedulePage(missing, PAGE_URL).ajaxUrl).toBe(
      'https://www.dtek-dnem.com.ua/ua/ajax',
    );
  });

  it('reads the cities and their streets', () => {
    const parsed = parseSchedulePage(
      page({
        streets: {
          'м. Тестове': ['вул. Тестова', 'пров. Тестовий'],
          'с. Тестове': ['вул. Лісова'],
        },
      }),
      PAGE_URL,
    );
    expect(parsed.streets).toEqual({
      'м. Тестове': ['вул. Тестова', 'пров. Тестовий'],
      'с. Тестове': ['вул. Лісова'],
    });
  });

  it('reads the weekly pattern as 24 hourly statuses per weekday, Monday = 1', () => {
    const { weekly } = parseSchedulePage(page(), PAGE_URL);
    expect(weekly.groupNames).toEqual({ 'GPV5.2': 'Черга 5.2' });
    const monday = weekly.groups['GPV5.2'][1];
    expect(monday).toHaveLength(24);
    expect(monday[7]).toBe('yes'); // 07:00-08:00
    expect(monday[8]).toBe('maybe'); // 08:00-09:00
    expect(monday[9]).toBe('mfirst'); // 09:00-10:00
    expect(weekly.groups['GPV5.2'][7][0]).toBe('yes');
  });

  it('maps a status it does not know to unknown instead of failing', () => {
    const odd = {
      ...preset,
      data: {
        'GPV5.2': {
          ...week('yes'),
          '3': slots('yes', { 1: 'blackout', 2: 'NO' }),
        },
      },
    };
    const { weekly } = parseSchedulePage(page({ preset: odd }), PAGE_URL);
    expect(weekly.groups['GPV5.2'][3].slice(0, 3)).toEqual([
      'unknown',
      'unknown',
      'yes',
    ]);
  });

  it('reads an empty confirmed schedule', () => {
    const { confirmed } = parseSchedulePage(page(), PAGE_URL);
    expect(confirmed).toEqual({
      today: 1791579600,
      updated: '24.07.2026 08:30',
      days: {},
    });
  });

  it('reads confirmed days keyed by the Kyiv midnight timestamp', () => {
    const fact = {
      data: {
        '1791579600': {
          'GPV5.2': slots('yes', { 19: 'no', 20: 'second' }),
          'GPV1.1': slots('yes'),
        },
        '1791666000': { 'GPV5.2': slots('no') },
      },
      update: '10.10.2026 20:40',
      today: 1791579600,
    };
    const { confirmed } = parseSchedulePage(page({ fact }), PAGE_URL);
    expect(confirmed.updated).toBe('10.10.2026 20:40');
    expect(Object.keys(confirmed.days)).toEqual(['1791579600', '1791666000']);
    expect(confirmed.days[1791579600]['GPV5.2'].slice(17, 21)).toEqual([
      'yes',
      'no',
      'second',
      'yes',
    ]);
    expect(confirmed.days[1791666000]['GPV5.2'].every((s) => s === 'no')).toBe(
      true,
    );
  });

  it('copes with escaped text and braces inside strings, as the site sends them', () => {
    const raw =
      'DisconSchedule.streets = {"\\u043c. \\u0422\\u0435\\u0441\\u0442\\u043e\\u0432\\u0435":["\\u0432\\u0443\\u043b. \\"{\\u0414\\u0443\\u0436\\u043a\\u0430}\\"","a\\/b"]}\n' +
      `DisconSchedule.preset = ${JSON.stringify(preset)}\n` +
      `DisconSchedule.fact = ${JSON.stringify(emptyFact)}`;
    expect(parseSchedulePage(page({ raw }), PAGE_URL).streets).toEqual({
      'м. Тестове': ['вул. "{Дужка}"', 'a/b'],
    });
  });

  it('recognises the firewall challenge page', () => {
    const challenge =
      '<html><head><META NAME="robots" CONTENT="noindex,nofollow"><script src="/_Incapsula_Resource?SWJIYLWA=5074a744e2e3d891814e9a2dace20bd4,719d34d31c8e3a6e6fffd425f7e032f3"></script></head><body></body></html>';
    const error = errorOf(challenge);
    expect(error.kind).toBe('challenge');
  });

  it('rejects a page whose schedule data is missing', () => {
    const error = errorOf(page({ preset: undefined }));
    expect(error.kind).toBe('shape');
    expect(error.message).toMatch(/preset/);
  });

  it('rejects a page without a CSRF token', () => {
    const error = errorOf(
      page({ head: '<meta name="ajaxUrl" content="/ua/ajax">' }),
    );
    expect(error.kind).toBe('shape');
    expect(error.message).toMatch(/csrf/i);
  });

  it('rejects a weekday that does not have all 24 slots', () => {
    const short = {
      ...preset,
      data: { 'GPV5.2': { ...week('yes'), '2': { '1': 'yes' } } },
    };
    const error = errorOf(page({ preset: short }));
    expect(error.kind).toBe('shape');
    expect(error.message).toMatch(/GPV5\.2/);
  });

  it('rejects slots that are not the 24 hours of the day', () => {
    const halfHours = {
      ...preset,
      time_zone: { ...hourly, '2': ['00-01', '00:30', '01:00'] },
    };
    expect(errorOf(page({ preset: halfHours })).kind).toBe('shape');
  });

  it('rejects streets that are not lists of names', () => {
    expect(
      errorOf(page({ streets: { 'м. Тестове': 'вул. Тестова' } })).kind,
    ).toBe('shape');
  });

  it('rejects a confirmed schedule without its timestamps', () => {
    expect(errorOf(page({ fact: { data: [] } })).kind).toBe('shape');
  });
});
