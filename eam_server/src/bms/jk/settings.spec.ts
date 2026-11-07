import { decodeSettings } from './settings';
import { referenceFrame } from './testing/reference-frames';

describe('decodeSettings, JK02_32S', () => {
  const s = decodeSettings(
    referenceFrame('SETTINGS_REAL_PB2A16S20P_19U'),
    'JK02_32S',
  );

  it('decodes the cell voltage limits', () => {
    expect(s).toMatchObject({
      smartSleepV: 3.5,
      cellUndervoltageProtectionV: 2.6,
      cellUndervoltageRecoveryV: 2.9,
      cellOvervoltageProtectionV: 3.6,
      cellOvervoltageRecoveryV: 3.448,
      powerOffV: 2.5,
      socFullV: 3.449,
      socEmptyV: 2.7,
      cellChargeV: 3.45,
      cellFloatV: 3.35,
    });
  });

  it('decodes balancing', () => {
    expect(s).toMatchObject({
      balancerEnabled: true,
      balanceStartV: 3.4,
      balanceTriggerDeltaV: 0.01,
      maxBalanceCurrentA: 2,
    });
  });

  it('decodes currents and their delays', () => {
    expect(s).toMatchObject({
      maxChargeCurrentA: 48,
      chargeOvercurrentDelayS: 3,
      chargeOvercurrentRecoveryS: 60,
      maxDischargeCurrentA: 100,
      dischargeOvercurrentDelayS: 300,
      dischargeOvercurrentRecoveryS: 60,
      shortCircuitRecoveryS: 5,
    });
  });

  it('decodes temperature limits, in °C', () => {
    expect(s).toMatchObject({
      chargeOvertemperatureC: 50,
      chargeOvertemperatureRecoveryC: 45,
      dischargeOvertemperatureC: 50,
      dischargeOvertemperatureRecoveryC: 45,
      chargeUndertemperatureC: 2,
      chargeUndertemperatureRecoveryC: 5,
      mosfetOvertemperatureC: 80,
      mosfetOvertemperatureRecoveryC: 70,
    });
  });

  it('decodes the pack and its switches', () => {
    expect(s).toMatchObject({
      cellCount: 8,
      nominalCapacityAh: 102,
      chargeEnabled: true,
      dischargeEnabled: true,
    });
  });

  it('reads below-zero temperatures as negative', () => {
    const frame = Buffer.from(referenceFrame('SETTINGS_REAL_PB2A16S20P_19U'));
    frame.writeInt32LE(-50, 98);
    expect(decodeSettings(frame, 'JK02_32S').chargeUndertemperatureC).toBe(-5);
  });
});

describe('decodeSettings, checks', () => {
  it('rejects frames that are not settings', () => {
    expect(() =>
      decodeSettings(
        referenceFrame('CELL_INFO_REAL_PB2A16S20P_19U'),
        'JK02_32S',
      ),
    ).toThrow(/settings/);
  });

  it('declines variants whose settings layout is not confirmed', () => {
    const frame = referenceFrame('SETTINGS_REAL_PB2A16S20P_19U');
    expect(() => decodeSettings(frame, 'JK02_24S')).toThrow(/JK02_24S/);
    expect(() => decodeSettings(frame, 'JK04')).toThrow(/JK04/);
  });
});
