import { alertText } from '../alerts/alert-message';
import type { Language } from '../i18n/languages';
import type { HostSample } from '../server-agent/sample';
import { serverAlerts, type AlertThresholds } from './server-alerts';

const THRESHOLDS: AlertThresholds = {
  heatC: 90,
  storageFreePercent: 10,
  memoryUsedPercent: 90,
};

const sample = (
  over: {
    celsius?: number;
    freeGb?: number;
    availableGb?: number;
    updates?: HostSample['updates'];
  } = {},
): HostSample => ({
  at: '2026-10-11T10:00:00.000Z',
  uptimeSeconds: 1,
  cpu: { usagePercent: 5, coresPercent: [], load: [0, 0, 0] },
  memory: {
    totalBytes: 8e9,
    availableBytes: (over.availableGb ?? 4) * 1e9,
    swapTotalBytes: 2e9,
    swapFreeBytes: 1e9,
  },
  disks: [
    { mount: '/', totalBytes: 200e9, freeBytes: (over.freeGb ?? 100) * 1e9 },
  ],
  network: [],
  temperatures: [
    { device: 'coretemp', label: 'Package id 0', celsius: over.celsius ?? 60 },
    { device: 'acpitz', label: 'temp1', celsius: 40 },
  ],
  fans: [],
  services: null,
  containers: null,
  ...(over.updates !== undefined && { updates: over.updates }),
});

/** Feeds samples in turn, collecting the notices as worded in `language`. */
function run(samples: HostSample[], language: Language = 'en') {
  let state;
  const notices = [];
  for (const s of samples) {
    const result = serverAlerts(state, s, THRESHOLDS);
    state = result.state;
    notices.push(...result.notices);
  }
  return notices.map((n) => ({
    kind: n.kind,
    text: alertText(n, language, 'UTC'),
  }));
}

describe('serverAlerts', () => {
  it('takes the first sample as the baseline', () => {
    expect(run([sample({ celsius: 99, freeGb: 1, availableGb: 0.1 })])).toEqual(
      [],
    );
  });

  it('says the server overheats after two hot readings, and when it cools down', () => {
    expect(
      run([
        sample(),
        sample({ celsius: 92 }),
        sample({ celsius: 93 }),
        sample({ celsius: 95 }),
        sample({ celsius: 87 }),
        sample({ celsius: 84 }),
      ]),
    ).toEqual([
      {
        kind: 'server-heat',
        text: 'Server: overheating, 93 °C (Package id 0)',
      },
      { kind: 'server-heat', text: 'Server: temperature back to 84 °C' },
    ]);
  });

  it('ignores a single hot reading', () => {
    expect(run([sample(), sample({ celsius: 95 }), sample()])).toEqual([]);
  });

  it('says when storage runs low, and when there is room again', () => {
    expect(
      run([
        sample(),
        sample({ freeGb: 16 }),
        sample({ freeGb: 15 }),
        sample({ freeGb: 21 }),
        sample({ freeGb: 25 }),
      ]),
    ).toEqual([
      {
        kind: 'server-storage',
        text: 'Server: storage low on /, 8 % free (16 GB)',
      },
      {
        kind: 'server-storage',
        text: 'Server: storage on / back to 12.5 % free',
      },
    ]);
  });

  it('words the notices in Ukrainian', () => {
    expect(
      run([sample(), sample({ freeGb: 16 }), sample({ freeGb: 25 })], 'uk').map(
        (n) => n.text,
      ),
    ).toEqual([
      'Сервер: мало місця на /, вільно 8 % (16 ГБ)',
      'Сервер: на / знову вільно 12,5 %',
    ]);
  });

  it('says memory is short after five readings over the limit, and when it is enough again', () => {
    const short = Array.from({ length: 5 }, () => sample({ availableGb: 0.4 }));
    expect(
      run([
        sample(),
        ...short,
        sample({ availableGb: 0.4 }),
        sample({ availableGb: 1 }),
        sample({ availableGb: 2 }),
      ]),
    ).toEqual([
      {
        kind: 'server-memory',
        text: 'Server: memory short, 95 % used, swap 1 GB used',
      },
      { kind: 'server-memory', text: 'Server: memory back to 75 % used' },
    ]);
  });

  it('says when security updates appear, and when a restart is needed', () => {
    const updates = (
      security: number,
      packages: number,
      rebootRequired = false,
    ) => ({
      checkedAt: '2026-10-11T10:00:00.000Z',
      packages,
      security,
      names: [],
      listsUpdatedAt: null,
      rebootRequired,
    });
    expect(
      run([
        sample({ updates: updates(1, 5) }),
        sample({ updates: updates(1, 5) }),
        sample({ updates: updates(3, 12) }),
        sample({ updates: updates(0, 0, true) }),
        sample({ updates: updates(0, 0, true) }),
      ]),
    ).toEqual([
      {
        kind: 'server-updates',
        text: 'Server: 3 security updates available (12 updates in all)',
      },
      {
        kind: 'server-updates',
        text: 'Server: restart required after updates',
      },
    ]);
  });
});
