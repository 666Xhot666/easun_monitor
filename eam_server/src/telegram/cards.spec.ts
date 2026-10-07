import { RegisterMap } from '../inverter/registers/register-map';
import { SMG_II_REGISTERS } from '../inverter/registers/smg-ii.registers';
import type { BmsReading } from '../bms/reading';
import {
  batteryCard,
  energyCard,
  escapeHtml,
  faultsCard,
  statusCard,
  weekCard,
} from './cards';

const map = new RegisterMap(SMG_II_REGISTERS);
const NOW = new Date('2026-10-06T19:00:00Z');

const bms = (overrides: Partial<BmsReading> = {}): BmsReading =>
  ({
    timestamp: '2026-10-06T18:59:48Z',
    packVoltageV: 26.48,
    currentA: -11.6,
    powerW: -307.2,
    stateOfChargePct: 88,
    cycleCount: 41,
    cellVoltagesV: [],
    cellMinV: 3.305,
    cellMaxV: 3.318,
    cellDeltaV: 0.013,
    cellMinIndex: 4,
    cellMaxIndex: 7,
    temperaturesC: [
      { name: 'T1', celsius: 24.5 },
      { name: 'MOS', celsius: 27.1 },
    ],
    balancing: true,
    alarms: [],
    ...overrides,
  }) as BmsReading;

describe('escapeHtml', () => {
  it('escapes what Telegram HTML treats as markup', () => {
    expect(escapeHtml('A & B <x>')).toBe('A &amp; B &lt;x&gt;');
  });
});

describe('statusCard', () => {
  it('shows mode, power flow, battery and the reading age', () => {
    const card = statusCard(
      'Garage <1>',
      map,
      {
        timestamp: new Date('2026-10-06T18:58:00Z'),
        payload: {
          OperationMode: 3,
          PVPower: 1240,
          OutputActivePower: 320,
          AverageMainsPower: 0,
          MainsVoltage: 0,
          BatterySoc: 88,
          BatteryVoltage: 26.5,
          BatteryCurrentSigned: -11.7,
        },
      },
      NOW,
    );

    expect(card).toBe(
      [
        '<b>🏠 Garage &lt;1&gt;</b> · Off-grid',
        '☀️ PV <b>1.24 kW</b>',
        '🏡 Load <b>320 W</b>',
        '🔌 Grid <b>0 W</b> · no grid',
        '🔋 Battery <b>88 %</b> · discharging 310 W',
        '<i>Reading 2 min ago</i>',
      ].join('\n'),
    );
  });

  it('marks missing values and an idle or charging battery', () => {
    const idle = statusCard(
      'Home',
      map,
      {
        timestamp: NOW,
        payload: {
          BatterySoc: 100,
          BatteryVoltage: 27,
          BatteryCurrentSigned: 0.1,
          MainsVoltage: 230,
        },
      },
      NOW,
    );
    expect(idle).toBe(
      [
        '<b>🏠 Home</b>',
        '☀️ PV <b>--</b>',
        '🏡 Load <b>--</b>',
        '🔌 Grid <b>--</b>',
        '🔋 Battery <b>100 %</b> · idle',
        '<i>Reading just now</i>',
      ].join('\n'),
    );
    const charging = statusCard(
      'Home',
      map,
      {
        timestamp: NOW,
        payload: {
          BatterySoc: 60,
          BatteryVoltage: 27,
          BatteryCurrentSigned: 10,
        },
      },
      NOW,
    );
    expect(charging).toContain('🔋 Battery <b>60 %</b> · charging 270 W');
  });

  it('says when there is no reading yet', () => {
    expect(statusCard('Home', map, null, NOW)).toBe(
      '<b>🏠 Home</b>\nNo readings yet',
    );
  });
});

describe('energyCard', () => {
  it("lists the day's energy per kind", () => {
    expect(
      energyCard('Home', {
        pvKWh: 3.456,
        gridKWh: 0.8,
        outputKWh: 12.34,
        batteryChargeKWh: 1.44,
        batteryDischargeKWh: 0.99,
        coveredSeconds: 36000,
      }),
    ).toBe(
      [
        '<b>⚡ Home · today</b>',
        '☀️ PV <b>3.46 kWh</b>',
        '🔌 Grid <b>0.80 kWh</b>',
        '🏡 Load <b>12.3 kWh</b>',
        '🔋 Battery <b>+1.44</b> charged · <b>-0.99 kWh</b> used',
      ].join('\n'),
    );
  });
});

describe('batteryCard', () => {
  it("shows the inverter's view and each BMS in detail", () => {
    const card = batteryCard(
      'Home',
      { BatterySoc: 88, BatteryVoltage: 26.5, BatteryCurrentSigned: -11.7 },
      [{ name: 'Pack', reading: bms({ alarms: ['Cell overvoltage'] }) }],
      NOW,
    );

    expect(card).toBe(
      [
        '<b>🔋 Home</b>',
        'Inverter: <b>88 %</b> · 26.50 V · -11.7 A',
        '',
        '<b>BMS Pack</b> · 12 s ago',
        '<b>88 %</b> · 26.48 V · -11.6 A · -307 W',
        'Cells 3.305–3.318 V · Δ 13 mV (low #4, high #7)',
        'Temp T1 24.5 °C · MOS 27.1 °C',
        'Cycles 41 · balancing',
        '⚠️ Cell overvoltage',
      ].join('\n'),
    );
  });

  it('leaves out what is unknown, and says when there is no BMS', () => {
    const card = batteryCard(
      'Home',
      null,
      [
        {
          name: 'Pack',
          reading: bms({
            cellMinV: null,
            cellMaxV: null,
            cellDeltaV: null,
            temperaturesC: [],
            cycleCount: null,
            balancing: false,
          }),
        },
      ],
      NOW,
    );
    expect(card).toBe(
      [
        '<b>🔋 Home</b>',
        'Inverter: no reading',
        '',
        '<b>BMS Pack</b> · 12 s ago',
        '<b>88 %</b> · 26.48 V · -11.6 A · -307 W',
      ].join('\n'),
    );

    expect(batteryCard('Home', { BatterySoc: 50 }, [], NOW)).toBe(
      ['<b>🔋 Home</b>', 'Inverter: <b>50 %</b>', '', 'No BMS reporting.'].join(
        '\n',
      ),
    );
  });
});

describe('faultsCard', () => {
  it('lists active faults and warnings by name', () => {
    const fault = map.activeFlags('FaultCode', 2)[0];
    const warning = map.activeFlags('WarningCode', 8)[0];

    expect(
      faultsCard('Home', map, {
        OperationMode: 6,
        FaultCode: 2,
        WarningCode: 8,
      }),
    ).toBe(
      [
        '<b>🚨 Home</b> · Fault',
        `Faults: ${fault}`,
        `Warnings: ${warning}`,
      ].join('\n'),
    );
  });

  it('says all clear, or that there is no reading', () => {
    expect(
      faultsCard('Home', map, {
        OperationMode: 3,
        FaultCode: 0,
        WarningCode: 0,
      }),
    ).toBe('<b>🚨 Home</b> · Off-grid\n✅ No faults or warnings');
    expect(faultsCard('Home', map, null)).toBe(
      '<b>🚨 Home</b>\nNo readings yet',
    );
  });
});

describe('weekCard', () => {
  const totals = (pv: number, grid: number, load: number) => ({
    pvKWh: pv,
    gridKWh: grid,
    outputKWh: load,
    batteryChargeKWh: 0,
    batteryDischargeKWh: 0,
    coveredSeconds: 0,
  });

  it('is a fixed-width table of the days, newest first, with totals', () => {
    expect(
      weekCard('Home', [
        { label: 'Tue 06', totals: totals(3.46, 0.8, 12.34) },
        { label: 'Mon 05', totals: totals(10.2, 15.05, 25) },
      ]),
    ).toBe(
      [
        '<b>📅 Home · kWh by day</b>',
        '<pre>',
        'Day        PV  Grid  Load',
        'Tue 06    3.5   0.8  12.3',
        'Mon 05   10.2  15.1  25.0',
        'Total    13.7  15.9  37.3',
        '</pre>',
      ].join('\n'),
    );
  });
});
