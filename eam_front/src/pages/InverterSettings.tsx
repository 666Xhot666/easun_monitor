import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from '../lib/apiClient';
import type { LucideIcon } from 'lucide-react';
import {
  Power,
  SlidersHorizontal,
  BatteryCharging,
  Settings2,
  ChevronDown,
  Send,
  RotateCcw,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import { extractErrorMessage } from '../lib/errors';

// ---------------------------------------------------------------------------
// Field model
//
// One declarative config drives every control on this page instead of ~40
// hand-written form blocks. Each field optionally carries a `modbusRef` —
// the real register this project already reverse-engineered into
// eam_server/src/inverter/commands.json's `get_smx_param` definition table
// (name + hex address; `rate` mirrors that table's own raw->real
// multiplier). Where a field has no confirmed register there (the SMX-II
// app exposes some settings — boot method, buzzer sub-modes, backlight,
// "clear record" — that aren't in the currently mapped set, either because
// they're datalogger-level commands or just haven't been captured yet),
// `modbusRef` is omitted and `mappingNote` says so plainly instead of
// inventing an address. Never guess a register.
//
// IMPORTANT: PollingService already reads every register in this table
// (settings and telemetry alike — see inverter.service.ts's
// PARAMETER_DEFINITIONS) on its normal 5s poll cycle, so this page never
// invents starting values. It fetches the inverter's own last-known
// reading (same /api/inverter/:profileId/latest endpoint the dashboard
// uses) and seeds every mapped field from there; a field with no confirmed
// register, or one the last poll simply didn't include this cycle, starts
// genuinely empty rather than defaulting to anything.
// ---------------------------------------------------------------------------

interface ModbusRef {
  /** Hex register address, exactly as commands.json spells it. */
  address: string;
  /** The register's name in commands.json, for cross-reference. */
  name: string;
}

interface BaseField {
  id: string;
  label: string;
  modbusRef?: ModbusRef;
  /** Shown on the "unmapped" badge when modbusRef is absent, or as a
   * clarifying aside (e.g. option-count mismatches vs. the real enum)
   * when it's present but imperfect. */
  mappingNote?: string;
  /** commands.json's own raw->real multiplier for this register (real =
   * raw * rate). Used both to read the already-scaled value the backend
   * puts in the poll payload as-is, and to invert a UI value back to a
   * raw integer when writing (raw = round(realValue / rate)). Undefined
   * = 1 (a plain integer or enum register — most of them). */
  rate?: number;
}

interface SelectField extends BaseField {
  kind: 'select';
  options: string[];
  /** UI label -> the register's real-world value (its raw enum index for
   * a plain DIS/ENA-style register, since those have no rate; or the
   * scaled number for a register that's numeric under the hood but
   * presented as a preset dropdown, e.g. Output Voltage). Only options
   * with a confirmed real value are listed here — see mappingNote for
   * any option that isn't. */
  deviceValues?: Record<string, number>;
}

interface SegmentedField extends BaseField {
  kind: 'segmented';
  /** [firstOption, secondOption] — rendered as a two-way pill toggle. */
  options: [string, string];
  deviceValues?: Record<string, number>;
}

interface NumberField extends BaseField {
  kind: 'number';
  unit: string;
  step: number;
  /** Only true for Time from C.V to Floating Charge: its register
   * (BatteryBoostChargeTime / E012) has no `rate` in commands.json — it's
   * raw seconds — but the mobile app (and this page) show it in minutes.
   * That's a display-unit choice independent of `rate` (which mirrors the
   * *register's own* scaling), so it's handled as its own explicit flag
   * rather than overloading `rate` with a second meaning. */
  secondsToMinutes?: boolean;
}

type SettingField = SelectField | SegmentedField | NumberField;

interface ActionField {
  id: string;
  label: string;
  confirmMessage: string;
  modbusRef?: ModbusRef;
  mappingNote?: string;
}

interface FieldGroup {
  heading?: string;
  fields: SettingField[];
}

interface SettingsSection {
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  groups: FieldGroup[];
  actions?: ActionField[];
}


// ---------------------------------------------------------------------------
// Section 1 — Device Control & Actions
// ---------------------------------------------------------------------------

const DEVICE_CONTROL_SECTION: SettingsSection = {
  id: 'device-control',
  title: 'Device Control & Actions',
  subtitle: 'Power-on behavior and one-shot commands sent straight to the inverter',
  icon: Power,
  groups: [
    {
      fields: [
        {
          id: 'bootMethod',
          kind: 'select',
          label: 'Boot Method',
          options: ['Can be powered on locally or remotely', 'Local power on only'],
          mappingNote:
            "Datalogger-level power-on policy — not one of the get_smx_param registers in commands.json, so there's no confirmed address or value to read/write yet.",
        },
        {
          id: 'autoAcOutput',
          kind: 'segmented',
          label: 'Auto AC Output',
          options: ['Disable With Power Switch OFF', 'Enable With Power Switch ON'],
          mappingNote: 'No confirmed register for this in commands.json yet.',
        },
        {
          id: 'outputControl',
          kind: 'segmented',
          label: 'Output Control',
          options: ['OFF', 'ON'],
          modbusRef: { address: 'df00', name: 'MachinePowerState' },
          deviceValues: { OFF: 0, ON: 1 },
          mappingNote: "commands.json's enum is SHUTDOWN(0)/BOOT(1) — OFF/ON map onto it 1:1.",
        },
      ],
    },
  ],
  actions: [
    {
      id: 'forcedEqChargingOnce',
      label: 'Forced EQ Charging Once',
      confirmMessage:
        'Start a one-time forced equalization charge now? This briefly raises the battery to the EQ voltage set below.',
      modbusRef: { address: 'DF0D', name: 'BatteryEqualizationImmediately' },
    },
    {
      id: 'exitFaultMode',
      label: 'Exit Fault Mode',
      confirmMessage: 'Clear the current fault and attempt to resume normal operation?',
      modbusRef: { address: 'df01', name: 'MachineReset' },
    },
    {
      id: 'clearRecord',
      label: 'Clear Record',
      confirmMessage: 'Permanently clear the inverter’s stored history/records?',
      mappingNote: 'Not present in commands.json — likely a datalogger housekeeping command, not a param register.',
    },
    {
      id: 'resetUserSettings',
      label: 'Reset User Settings',
      confirmMessage:
        'Reset every setting on this page back to the inverter’s factory defaults? This cannot be undone.',
      mappingNote: 'Not present in commands.json — distinct from the WiFi module’s own factory-reset-wifi command sequence.',
    },
  ],
};

// ---------------------------------------------------------------------------
// Section 2 — Basic Settings
// ---------------------------------------------------------------------------

const BASIC_SETTINGS_SECTION: SettingsSection = {
  id: 'basic-settings',
  title: 'Basic Settings',
  subtitle: 'Output mode, source priority, and grid-facing electrical parameters',
  icon: SlidersHorizontal,
  groups: [
    {
      fields: [
        {
          id: 'outputMode',
          kind: 'select',
          label: 'Output Mode',
          options: ['Single', 'Parallel', '3-Phase'],
          mappingNote:
            'On real SMX-II hardware this is set by physical DIP switches, not a single Modbus register — commands.json has related-but-not-equivalent registers (SplitPhase/E214, ParallelModeNotSupported?/E201), not a clean 3-way match.',
        },
        {
          id: 'outputPriority',
          kind: 'select',
          label: 'Output Priority',
          options: ['SUB Priority', 'SBU Priority', 'Utility First (UTI)', 'Solar First (SOL)'],
          modbusRef: { address: 'E204', name: 'OutputPriority' },
          deviceValues: {
            'Solar First (SOL)': 0,
            'Utility First (UTI)': 1,
            'SBU Priority': 2,
          },
          mappingNote:
            "commands.json's OutputPriority enum only has 3 states (SOL=0/UTI=1/SBU=2) — “SUB Priority” has no confirmed raw value on this device.",
        },
        {
          id: 'inputVoltageRange',
          kind: 'select',
          label: 'Input Voltage Range',
          options: ['Generator', 'Appliance', 'UPS'],
          modbusRef: { address: 'E20B', name: 'AcInputVoltageRange' },
          deviceValues: {
            Appliance: 0,
            UPS: 1,
          },
          mappingNote:
            "commands.json's AcInputVoltageRange enum only has APL=0(Appliance)/UPS=1 (2 states) — “Generator” has no confirmed raw value on this device.",
        },
        {
          id: 'outputVoltage',
          kind: 'select',
          label: 'Output Voltage',
          options: ['220Vac', '230Vac', '240Vac'],
          modbusRef: { address: 'E208', name: 'OutputVoltageSet' },
          rate: 0.1,
          deviceValues: { '220Vac': 220, '230Vac': 230, '240Vac': 240 },
        },
        {
          id: 'outputFrequency',
          kind: 'segmented',
          label: 'Output Frequency',
          options: ['50Hz', '60Hz'],
          modbusRef: { address: 'E209', name: 'OutputFrequency' },
          rate: 0.01,
          deviceValues: { '50Hz': 50, '60Hz': 60 },
        },
      ],
    },
  ],
};


// ---------------------------------------------------------------------------
// Section 3 — Battery Settings
// ---------------------------------------------------------------------------

const BATTERY_SETTINGS_SECTION: SettingsSection = {
  id: 'battery-settings',
  title: 'Battery Settings',
  subtitle: 'Chemistry, charge current limits, voltage thresholds, and equalization',
  icon: BatteryCharging,
  groups: [
    {
      heading: 'Chemistry & Priority',
      fields: [
        {
          id: 'batteryType',
          kind: 'select',
          label: 'Battery Type',
          options: ['User-Defined', 'AGM', 'Flooded', 'GEL', 'LiFePO4'],
          modbusRef: { address: 'E004', name: 'BatteryType' },
          deviceValues: {
            'User-Defined': 0,
            AGM: 1,
            Flooded: 2,
            GEL: 3,
            LiFePO4: 4,
          },
          mappingNote:
            "commands.json's BatteryType enum has a 6th state, NCA=5, with no option in this dropdown — the device can report/accept a chemistry this UI can't select.",
        },
        {
          id: 'chargerSourcePriority',
          kind: 'select',
          label: 'Charger Source Priority',
          options: [
            'PV Is At The Same Level As Utility (SNU)',
            'Solar First (CSO)',
            'Utility First (CUB)',
            'Solar Only (OSO)',
          ],
          modbusRef: { address: 'E20F', name: 'ChargerSourcePriority' },
          deviceValues: {
            'Solar First (CSO)': 0,
            'Utility First (CUB)': 1,
            'PV Is At The Same Level As Utility (SNU)': 2,
            'Solar Only (OSO)': 3,
          },
        },
      ],
    },
    {
      heading: 'Charging Current Limits',
      fields: [
        {
          id: 'maxChargingCurrent',
          kind: 'number',
          label: 'Max. Charging Current',
          unit: 'A',
          step: 0.1,
          rate: 0.1,
          modbusRef: { address: 'E20A', name: 'MaxChargerCurrent' },
          mappingNote:
            'commands.json also has MaxPVChargerCurrent (E001) and MaxChargeCurrentByPV (E120) — two more current-limit registers this page does not (yet) expose; see chat for details.',
        },
        {
          id: 'maxAcChargingCurrent',
          kind: 'number',
          label: 'Max. AC Charging Current',
          unit: 'A',
          step: 0.1,
          rate: 0.1,
          modbusRef: { address: 'E205', name: 'MaxACChargerCurrent' },
        },
      ],
    },
    {
      heading: 'Voltage Thresholds (V)',
      fields: [
        {
          id: 'highDcProtectionVoltage',
          kind: 'number',
          label: 'High DC Protection Voltage',
          unit: 'V',
          step: 0.1,
          mappingNote: 'Bus over-voltage hardware protection isn’t a settable param in commands.json — it’s reported as a fault code (CurrentFault), not written as a threshold.',
        },
        {
          id: 'bulkChargingVoltage',
          kind: 'number',
          label: 'Bulk Charging Voltage / C.V Voltage',
          unit: 'V',
          step: 0.1,
          rate: 0.2,
          modbusRef: { address: 'E008', name: 'BatteryBoostChargeVoltage' },
          mappingNote: 'commands.json calls the CV/bulk stage “Boost”.',
        },
        {
          id: 'floatingChargingVoltage',
          kind: 'number',
          label: 'Floating Charging Voltage',
          unit: 'V',
          step: 0.1,
          rate: 0.2,
          modbusRef: { address: 'E009', name: 'BatteryFloatingChargeVoltage' },
        },
        {
          id: 'recoveryVoltageBackToMains',
          kind: 'number',
          label: 'Recovery Voltage Back To Mains Mode',
          unit: 'V',
          step: 0.1,
          rate: 0.2,
          modbusRef: { address: 'E01B', name: 'TurnToMainsVoltage' },
          mappingNote:
            'commands.json also has two other voltage-recovery registers (BatteryUndervoltageRecovery/E00B, BatteryChargeRecovery/E00A) not distinguished by this single UI field — see chat for details.',
        },
        {
          id: 'lowDcProtectionVoltageMains',
          kind: 'number',
          label: 'Low DC Protection Voltage In Mains Mode',
          unit: 'V',
          step: 0.1,
          rate: 0.2,
          modbusRef: { address: 'E00C', name: 'BatteryUnderVoltageAlarm' },
        },
        {
          id: 'lowDcProtectionVoltageOffGrid',
          kind: 'number',
          label: 'Low DC Protection Voltage In Off-Grid Mode',
          unit: 'V',
          step: 0.1,
          rate: 0.2,
          modbusRef: { address: 'E00D', name: 'BatteryOverDischargeVoltage' },
          mappingNote:
            'commands.json also has BatteryDischargeLimitVoltage (E00E), a separate register this field does not cover — see chat for details.',
        },
      ],
    },
    {
      heading: 'SOC Thresholds (%)',
      fields: [
        {
          id: 'socRecoveryMains',
          kind: 'number',
          label: 'SOC recovery value of battery discharge in mains mode',
          unit: '%',
          step: 1,
          mappingNote: 'This device’s register map protects on voltage, not SOC — no confirmed param for an SOC threshold.',
        },
        {
          id: 'lowDcProtectionSocGrid',
          kind: 'number',
          label: 'Low DC Protection SOC In Grid Mode',
          unit: '%',
          step: 1,
          mappingNote: 'Same as above — no SOC-based register confirmed.',
        },
        {
          id: 'offGridSocProtection',
          kind: 'number',
          label: 'Off grid mode battery discharge SOC protection value',
          unit: '%',
          step: 1,
          mappingNote: 'Same as above — no SOC-based register confirmed.',
        },
      ],
    },
    {
      heading: 'Charge Timers & Equalization (EQ)',
      fields: [
        {
          id: 'timeFromCvToFloating',
          kind: 'number',
          label: 'Time from C.V to Floating Charge',
          unit: 'min',
          step: 1,
          secondsToMinutes: true,
          modbusRef: { address: 'E012', name: 'BatteryBoostChargeTime' },
          mappingNote: 'commands.json stores this register in seconds — shown here in minutes.',
        },
        {
          id: 'batteryEqMode',
          kind: 'segmented',
          label: 'Battery EQ Mode',
          options: ['Disable', 'Enable'],
          modbusRef: { address: 'E206', name: 'BatteryEqualizationEnable' },
          deviceValues: { Disable: 0, Enable: 1 },
        },
        {
          id: 'eqChargingVoltage',
          kind: 'number',
          label: 'EQ Charing Voltage',
          unit: 'V',
          step: 0.1,
          rate: 0.2,
          modbusRef: { address: 'E007', name: 'BatteryEqualizationVoltage' },
        },
        {
          id: 'eqChargingTime',
          kind: 'number',
          label: 'EQ Charing Time',
          unit: 'min',
          step: 1,
          modbusRef: { address: 'E011', name: 'BatteryEqualizedTime' },
        },
        {
          id: 'eqTimeoutExitTime',
          kind: 'number',
          label: 'EQ Timeout Exit time',
          unit: 'min',
          step: 1,
          modbusRef: { address: 'E023', name: 'BatteryEqualizedTimeOut' },
        },
        {
          id: 'eqIntervalTime',
          kind: 'number',
          label: 'EQ Interval Time',
          unit: 'day',
          step: 1,
          modbusRef: { address: 'E013', name: 'BatteryEqualizationInterval' },
        },
      ],
    },
  ],
};


// ---------------------------------------------------------------------------
// Section 4 — System Settings
// ---------------------------------------------------------------------------

const SYSTEM_SETTINGS_SECTION: SettingsSection = {
  id: 'system-settings',
  title: 'System Settings',
  subtitle: 'Buzzer, display, power saving, and auto-restart behavior',
  icon: Settings2,
  groups: [
    {
      fields: [
        {
          id: 'buzzerMode',
          kind: 'select',
          label: 'Buzzer Mode',
          options: ['Beeps only in fault mode', 'Beeps ON', 'Beeps OFF'],
          modbusRef: { address: 'E210', name: 'AlarmEnable' },
          deviceValues: { 'Beeps OFF': 0, 'Beeps ON': 1 },
          mappingNote:
            "commands.json's AlarmEnable is a plain DIS(0)/ENA(1) register — “Beeps only in fault mode” has no separate confirmed raw value.",
        },
        {
          id: 'beepsWhilePrimarySourceInterrupted',
          kind: 'segmented',
          label: 'Beeps While Primary Source Is Interrupted',
          options: ['Beeps OFF', 'Beeps ON'],
          modbusRef: { address: 'E211', name: 'InputChangeAlarm' },
          deviceValues: { 'Beeps OFF': 0, 'Beeps ON': 1 },
        },
        {
          id: 'backlightControl',
          kind: 'segmented',
          label: 'Backlight Control',
          options: ['Backlight Timing Off', 'Backlight On'],
          mappingNote: 'No confirmed register for this in commands.json yet.',
        },
        {
          id: 'autoReturnToDefaultScreen',
          kind: 'segmented',
          label: 'Auto Return To Default Display Screen',
          options: ['Stay At Latest Screen', 'Return To Default Display Screen'],
          mappingNote: 'No confirmed register for this in commands.json yet.',
        },
        {
          id: 'powerSavingMode',
          kind: 'segmented',
          label: 'Power Saving Mode',
          options: ['Saving Mode Disable', 'Saving Mode Enable'],
          modbusRef: { address: 'E20C', name: 'PowerSavingMode' },
          deviceValues: { 'Saving Mode Disable': 0, 'Saving Mode Enable': 1 },
        },
        {
          id: 'autoRestartOverload',
          kind: 'segmented',
          label: 'Auto Restart When Overload Occurs',
          options: ['Auto Restart Disable', 'Auto Restart Enable'],
          modbusRef: { address: 'E20D', name: 'RestartWhenOverLoad' },
          deviceValues: { 'Auto Restart Disable': 0, 'Auto Restart Enable': 1 },
        },
        {
          id: 'autoRestartOverTemperature',
          kind: 'segmented',
          label: 'Auto Restart When Over Temperature Occurs',
          options: ['Auto Restart Disable', 'Auto Restart Enable'],
          modbusRef: { address: 'E20E', name: 'RestartWhenOverTemperature' },
          deviceValues: { 'Auto Restart Disable': 0, 'Auto Restart Enable': 1 },
        },
        {
          id: 'overloadBypass',
          kind: 'segmented',
          label: 'Overload Bypass',
          options: ['Disable', 'Enable'],
          modbusRef: { address: 'E212', name: 'BypassOutputWhenOverLoad' },
          deviceValues: { Disable: 0, Enable: 1 },
        },
      ],
    },
  ],
};

const SECTIONS: SettingsSection[] = [
  DEVICE_CONTROL_SECTION,
  BASIC_SETTINGS_SECTION,
  BATTERY_SETTINGS_SECTION,
  SYSTEM_SETTINGS_SECTION,
];


// ---------------------------------------------------------------------------
// Reading FROM the device (hydrate the form) and writing TO it (payload)
//
// Both directions go through the same two ideas per field:
//  - number field: the poll payload already carries the register's real
//    value (backend applies commands.json's own `rate` before we ever see
//    it) — so read is a direct copy, and write inverts it back to a raw
//    integer via round(realValue / rate). secondsToMinutes is the one
//    exception, converting units the backend doesn't know about.
//  - select/segmented field: `deviceValues` says what real-world value
//    each UI label corresponds to; read matches the payload's value back
//    to a label, write looks the label up to get the real value (then
//    applies rate, for the two numeric-backed presets — Output Voltage,
//    Output Frequency — that aren't true enums).
// ---------------------------------------------------------------------------

const DEVICE_VALUE_MATCH_EPSILON = 0.05;

/** Derives this field's starting UI value from the inverter's last known
 * poll payload — '' (genuinely empty, not a fabricated default) when the
 * field has no confirmed register, or the last poll cycle simply didn't
 * include it (a single bad register is skipped per-cycle, not fatal —
 * see InverterService.fetchDeviceData's own doc comment). */
function deriveValueFromPayload(field: SettingField, payload: Record<string, number>): string {
  if (!field.modbusRef) return '';
  const raw = payload[field.modbusRef.name];
  if (typeof raw !== 'number' || Number.isNaN(raw)) return '';

  if (field.kind === 'number') {
    return String(field.secondsToMinutes ? raw / 60 : raw);
  }

  const deviceValues = field.deviceValues ?? {};
  const match = Object.entries(deviceValues).find(
    ([, realValue]) => Math.abs(realValue - raw) < DEVICE_VALUE_MATCH_EPSILON,
  );
  return match ? match[0] : '';
}

interface ModbusEntry {
  id: string;
  label: string;
  address: string | null;
  registerName: string | null;
  uiValue: string;
  modbusValue: number | null;
}

function buildModbusEntry(field: SettingField, uiValue: string): ModbusEntry {
  const address = field.modbusRef?.address ?? null;
  const registerName = field.modbusRef?.name ?? null;
  const rate = field.rate ?? 1;

  if (field.kind === 'number') {
    const numeric = Number(uiValue);
    const hasValue = uiValue !== '' && Number.isFinite(numeric);
    const modbusValue = hasValue
      ? Math.round(field.secondsToMinutes ? numeric * 60 : numeric / rate)
      : null;
    return { id: field.id, label: field.label, address, registerName, uiValue, modbusValue };
  }

  const realValue = field.deviceValues?.[uiValue];
  const modbusValue = realValue === undefined ? null : Math.round(realValue / rate);
  return { id: field.id, label: field.label, address, registerName, uiValue, modbusValue };
}

/** Stand-in for the real `POST /api/inverter/:profileId/settings` call this
 * page doesn't have a backend for yet — logs exactly the payload that call
 * would send (register address + already-scaled integer per entry) and
 * resolves after a short, jittered delay so the UI's pending/sent states
 * have something realistic to animate through. Swap the body of this
 * function for the real axios call once that endpoint exists; every
 * caller below is already written against "returns a Promise", not this
 * mock's specifics. */
async function sendToInverter(entries: ModbusEntry[]): Promise<void> {
  // Deliberate console.log: stands in for the network call, so seeing the
  // exact payload in devtools is the point.
  console.log('[InverterSettings] simulated Modbus write', entries);
  await new Promise((resolve) => setTimeout(resolve, 450 + Math.random() * 350));
}


// ---------------------------------------------------------------------------
// UI primitives
// ---------------------------------------------------------------------------

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function inputClasses(): string {
  return 'mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';
}

/** Small monospace pill next to a label showing the real register this
 * control writes to, or — when there isn't a confirmed one — a muted
 * "unmapped" pill. Hover/focus reveals the full note via `title`, so the
 * exhaustive detail doesn't have to live in the layout itself. */
function ModbusBadge({ field }: { field: SettingField | ActionField }) {
  if (field.modbusRef) {
    return (
      <span
        title={field.mappingNote ?? (field.modbusRef.name + ' — ' + field.modbusRef.address)}
        className="ml-2 inline-flex items-center rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300"
      >
        {field.modbusRef.address}
      </span>
    );
  }
  return (
    <span
      title={field.mappingNote ?? 'No confirmed Modbus register for this control yet.'}
      className="ml-2 inline-flex items-center rounded border border-dashed border-gray-300 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 dark:border-gray-700 dark:text-gray-600"
    >
      unmapped
    </span>
  );
}

function SegmentedToggle({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: [string, string];
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-1 inline-flex rounded-lg border border-gray-300 p-0.5 dark:border-gray-700">
      {options.map((option) => {
        const isActive = option === value;
        return (
          <button
            key={option}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option)}
            className={cx(
              'rounded-md px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
              isActive
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

function SelectInput({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: string[];
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={inputClasses()}
    >
      {/* Only shown while nothing's been read from the device (or picked)
          yet — never a real, selectable choice, just makes the "empty"
          state legible in a control that otherwise always shows some
          option's text. */}
      {value === '' && (
        <option value="" disabled>
          Not available from device
        </option>
      )}
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function NumberInput({
  value,
  unit,
  step,
  onChange,
  disabled,
}: {
  value: string;
  unit: string;
  step: number;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative mt-1">
      <input
        type="number"
        step={step}
        value={value}
        placeholder="Not available from device"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cx(inputClasses(), 'mt-0 pr-12')}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-gray-400 dark:text-gray-500">
        {unit}
      </span>
    </div>
  );
}


function FieldRow({
  field,
  value,
  isPending,
  isSending,
  justSent,
  onChange,
  onSend,
}: {
  field: SettingField;
  value: string;
  isPending: boolean;
  isSending: boolean;
  justSent: boolean;
  onChange: (next: string) => void;
  onSend: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0 flex-1">
        <label className="flex flex-wrap items-center text-sm font-medium text-gray-700 dark:text-gray-300">
          {field.label}
          <ModbusBadge field={field} />
        </label>

        {field.kind === 'select' && (
          <div className="max-w-sm">
            <SelectInput value={value} options={field.options} onChange={onChange} disabled={isSending} />
          </div>
        )}
        {field.kind === 'segmented' && (
          <SegmentedToggle value={value} options={field.options} onChange={onChange} disabled={isSending} />
        )}
        {field.kind === 'number' && (
          <div className="max-w-[10rem]">
            <NumberInput
              value={value}
              unit={field.unit}
              step={field.step}
              onChange={onChange}
              disabled={isSending}
            />
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:pt-6">
        {justSent && !isPending && (
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Sent ✓</span>
        )}
        <button
          type="button"
          onClick={onSend}
          disabled={!isPending || isSending}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed',
            isPending
              ? 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60'
              : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600',
          )}
        >
          <Send className="h-3.5 w-3.5" />
          {isSending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

function ActionRow({
  action,
  isRunning,
  lastRunAt,
  onRun,
}: {
  action: ActionField;
  isRunning: boolean;
  lastRunAt: string | null;
  onRun: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
      <div className="flex items-center text-sm text-gray-700 dark:text-gray-300">
        <AlertTriangle className="mr-2 h-4 w-4 shrink-0 text-amber-500" />
        <span className="font-medium">{action.label}</span>
        <ModbusBadge field={action} />
      </div>
      <div className="flex items-center gap-2">
        {lastRunAt && (
          <span className="text-xs text-gray-400 dark:text-gray-500">Last sent {lastRunAt}</span>
        )}
        <button
          type="button"
          onClick={onRun}
          disabled={isRunning}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          {isRunning ? 'Sending…' : action.label}
        </button>
      </div>
    </div>
  );
}

function AccordionSection({
  section,
  isOpen,
  onToggle,
  pendingCount,
  children,
}: {
  section: SettingsSection;
  isOpen: boolean;
  onToggle: () => void;
  pendingCount: number;
  children: ReactNode;
}) {
  const Icon = section.icon;
  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{section.title}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">{section.subtitle}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {pendingCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              {pendingCount} unsent
            </span>
          )}
          <ChevronDown
            className={cx(
              'h-4 w-4 text-gray-400 transition-transform',
              isOpen && 'rotate-180',
            )}
          />
        </div>
      </button>
      {isOpen && (
        <div className="border-t border-gray-100 px-5 pb-2 dark:border-gray-800">{children}</div>
      )}
    </section>
  );
}

function PendingBar({
  pendingCount,
  isSendingAll,
  onSendAll,
  onDiscardAll,
}: {
  pendingCount: number;
  isSendingAll: boolean;
  onSendAll: () => void;
  onDiscardAll: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {pendingCount} setting{pendingCount === 1 ? '' : 's'} changed but not sent to the inverter
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDiscardAll}
            disabled={isSendingAll}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <RotateCcw className="h-4 w-4" />
            Discard
          </button>
          <button
            type="button"
            onClick={onSendAll}
            disabled={isSendingAll}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
            {isSendingAll ? 'Sending…' : 'Send all changes'}
          </button>
        </div>
      </div>
    </div>
  );
}


// Flattened once at module scope since SECTIONS is static — no reason to
// recompute this on every render/component instance.
const ALL_FIELDS: SettingField[] = SECTIONS.flatMap((section) =>
  section.groups.flatMap((group) => group.fields),
);
const ALL_FIELD_IDS: string[] = ALL_FIELDS.map((field) => field.id);
const FIELDS_BY_ID = new Map(ALL_FIELDS.map((field) => [field.id, field]));

/** Every field starts blank — see the big comment at the top of this file:
 * this page never guesses a starting value, only the inverter's own last
 * poll does. */
function emptyValues(): Record<string, string> {
  return Object.fromEntries(ALL_FIELD_IDS.map((id) => [id, '']));
}

type LoadState = 'loading' | 'ready' | 'no-data' | 'unreachable';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function InverterSettings() {
  const { profileId: profileIdParam } = useParams<{ profileId: string }>();
  const { user } = useAuth();
  const activeProfile = user?.inverterProfiles.find((p) => p.id === Number(profileIdParam));

  const [openSectionIds, setOpenSectionIds] = useState<Set<string>>(
    () => new Set([DEVICE_CONTROL_SECTION.id]),
  );
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>(emptyValues);
  // The last set of values actually confirmed from the device (the poll
  // payload right after load, or whatever was last successfully "sent").
  // Everything in `values` that differs from its counterpart here is a
  // pending, unsent edit.
  const [sentValues, setSentValues] = useState<Record<string, string>>(emptyValues);
  const [sendingFieldIds, setSendingFieldIds] = useState<Set<string>>(new Set());
  const [justSentFieldIds, setJustSentFieldIds] = useState<Set<string>>(new Set());
  const [isSendingAll, setIsSendingAll] = useState(false);
  const [runningActionIds, setRunningActionIds] = useState<Set<string>>(new Set());
  const [actionLastRun, setActionLastRun] = useState<Record<string, string>>({});

  const numericProfileId = Number(profileIdParam);

  // Pure fetch — touches no React state, so it's safe to call from
  // anywhere (a mount effect, a button handler) without either call site
  // risking the "setState directly in an effect" cascading-render lint
  // rule. Each caller decides what to do with the result itself, mirroring
  // Dashboard.tsx's own fetchLatest: state updates stay inline at the call
  // site, not hidden behind a shared function reference.
  async function reloadSettingsFromDevice() {
    if (!Number.isFinite(numericProfileId)) return;
    setLoadState('loading');
    setLoadError(null);
    try {
      const { data } = await axios.get<{ payload?: Record<string, number> }>(
        `/api/inverter/${numericProfileId}/latest`,
      );
      const payload = data.payload ?? {};
      const next: Record<string, string> = {};
      for (const field of ALL_FIELDS) {
        next[field.id] = deriveValueFromPayload(field, payload);
      }
      setValues(next);
      setSentValues(next);
      setLoadState('ready');
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        // Backend is up, but this inverter hasn't reported in yet — same
        // "no-data" distinction Dashboard.tsx makes.
        setLoadState('no-data');
      } else {
        setLoadError(
          extractErrorMessage(error, "Couldn't load the inverter's current settings."),
        );
        setLoadState('unreachable');
      }
    }
  }

  useEffect(() => {
    // Defined and invoked entirely inside the effect (same shape as
    // Dashboard.tsx's fetchLatest) rather than calling the component-level
    // reloadSettingsFromDevice by reference — that's what the lint rule
    // above is actually about, not the setState calls themselves.
    if (!Number.isFinite(numericProfileId)) return;
    let cancelled = false;

    async function run() {
      setLoadState('loading');
      setLoadError(null);
      try {
        const { data } = await axios.get<{ payload?: Record<string, number> }>(
          `/api/inverter/${numericProfileId}/latest`,
        );
        if (cancelled) return;
        const payload = data.payload ?? {};
        const next: Record<string, string> = {};
        for (const field of ALL_FIELDS) {
          next[field.id] = deriveValueFromPayload(field, payload);
        }
        setValues(next);
        setSentValues(next);
        setLoadState('ready');
      } catch (error) {
        if (cancelled) return;
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          setLoadState('no-data');
        } else {
          setLoadError(
            extractErrorMessage(error, "Couldn't load the inverter's current settings."),
          );
          setLoadState('unreachable');
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [numericProfileId]);

  const pendingFieldIds = useMemo(
    () => ALL_FIELD_IDS.filter((id) => values[id] !== sentValues[id]),
    [values, sentValues],
  );

  function toggleSection(id: string) {
    setOpenSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function flashSent(fieldId: string) {
    setJustSentFieldIds((prev) => new Set(prev).add(fieldId));
    setTimeout(() => {
      setJustSentFieldIds((prev) => {
        const next = new Set(prev);
        next.delete(fieldId);
        return next;
      });
    }, 2500);
  }

  async function handleSendField(fieldId: string) {
    const field = FIELDS_BY_ID.get(fieldId);
    if (!field) return;
    setSendingFieldIds((prev) => new Set(prev).add(fieldId));
    try {
      const entry = buildModbusEntry(field, values[fieldId]);
      await sendToInverter([entry]);
      setSentValues((prev) => ({ ...prev, [fieldId]: values[fieldId] }));
      flashSent(fieldId);
    } finally {
      setSendingFieldIds((prev) => {
        const next = new Set(prev);
        next.delete(fieldId);
        return next;
      });
    }
  }

  async function handleSendAll() {
    if (pendingFieldIds.length === 0) return;
    setIsSendingAll(true);
    try {
      const entries = pendingFieldIds
        .map((id) => FIELDS_BY_ID.get(id))
        .filter((field): field is SettingField => Boolean(field))
        .map((field) => buildModbusEntry(field, values[field.id]));
      await sendToInverter(entries);
      setSentValues(values);
      pendingFieldIds.forEach(flashSent);
    } finally {
      setIsSendingAll(false);
    }
  }

  function handleDiscardAll() {
    setValues(sentValues);
  }

  function handleRefreshClick() {
    if (pendingFieldIds.length > 0) {
      const confirmed = window.confirm(
        'Discard unsent changes and reload current values from the inverter?',
      );
      if (!confirmed) return;
    }
    void reloadSettingsFromDevice();
  }

  async function handleRunAction(action: ActionField) {
    if (!window.confirm(action.confirmMessage)) return;
    setRunningActionIds((prev) => new Set(prev).add(action.id));
    try {
      await sendToInverter([
        {
          id: action.id,
          label: action.label,
          address: action.modbusRef?.address ?? null,
          registerName: action.modbusRef?.name ?? null,
          uiValue: 'trigger',
          modbusValue: action.modbusRef ? 1 : null,
        },
      ]);
      setActionLastRun((prev) => ({ ...prev, [action.id]: new Date().toLocaleTimeString() }));
    } finally {
      setRunningActionIds((prev) => {
        const next = new Set(prev);
        next.delete(action.id);
        return next;
      });
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-28 dark:bg-gray-950">
      <header className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Settings &amp; Configuration
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {activeProfile ? 'Configuring ' + activeProfile.name : 'Loading inverter…'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={loadState === 'loading'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <RefreshCw className={cx('h-3.5 w-3.5', loadState === 'loading' && 'animate-spin')} />
              Refresh from device
            </button>
            {activeProfile && (
              <Link
                to={'/dashboard/' + activeProfile.id}
                className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                Back to dashboard
              </Link>
            )}
          </div>
        </div>
      </header>

      {loadState === 'loading' && (
        <div className="flex items-center justify-center py-24">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Reading current settings from the inverter…
          </p>
        </div>
      )}

      {loadState === 'no-data' && (
        <div className="flex items-center justify-center px-4 py-24 text-center">
          <div>
            <p className="text-lg font-medium text-gray-700 dark:text-gray-200">No readings yet</p>
            <p className="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">
              This inverter hasn't reported a poll cycle yet, so its current settings can't be
              read. Try again once the dashboard shows live data.
            </p>
            <button
              type="button"
              onClick={() => {
                void reloadSettingsFromDevice();
              }}
              className="mt-4 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {loadState === 'unreachable' && (
        <div className="flex items-center justify-center px-4 py-24 text-center">
          <div>
            <p className="text-lg font-medium text-red-600 dark:text-red-400">
              Can't reach the backend
            </p>
            <p className="mt-1 max-w-sm text-sm text-gray-500 dark:text-gray-400">{loadError}</p>
            <button
              type="button"
              onClick={() => {
                void reloadSettingsFromDevice();
              }}
              className="mt-4 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {loadState === 'ready' && (
        <main className="mx-auto max-w-4xl space-y-4 px-6 py-8">
          {SECTIONS.map((section) => {
            const sectionFieldIds = section.groups.flatMap((g) => g.fields.map((f) => f.id));
            const sectionPendingCount = sectionFieldIds.filter((id) =>
              pendingFieldIds.includes(id),
            ).length;

            return (
              <AccordionSection
                key={section.id}
                section={section}
                isOpen={openSectionIds.has(section.id)}
                onToggle={() => toggleSection(section.id)}
                pendingCount={sectionPendingCount}
              >
                {section.groups.map((group, groupIndex) => (
                  <div
                    key={group.heading ?? groupIndex}
                    className={cx(
                      'divide-y divide-gray-100 dark:divide-gray-800',
                      groupIndex > 0 && 'mt-2 border-t border-gray-100 pt-2 dark:border-gray-800',
                    )}
                  >
                    {group.heading && (
                      <p className="pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                        {group.heading}
                      </p>
                    )}
                    {group.fields.map((field) => (
                      <FieldRow
                        key={field.id}
                        field={field}
                        value={values[field.id]}
                        isPending={pendingFieldIds.includes(field.id)}
                        isSending={sendingFieldIds.has(field.id)}
                        justSent={justSentFieldIds.has(field.id)}
                        onChange={(next) => setValues((prev) => ({ ...prev, [field.id]: next }))}
                        onSend={() => {
                          void handleSendField(field.id);
                        }}
                      />
                    ))}
                  </div>
                ))}

                {section.actions && (
                  <div className="mt-2 divide-y divide-gray-100 border-t border-gray-100 pt-1 dark:divide-gray-800 dark:border-gray-800">
                    {section.actions.map((action) => (
                      <ActionRow
                        key={action.id}
                        action={action}
                        isRunning={runningActionIds.has(action.id)}
                        lastRunAt={actionLastRun[action.id] ?? null}
                        onRun={() => {
                          void handleRunAction(action);
                        }}
                      />
                    ))}
                  </div>
                )}
              </AccordionSection>
            );
          })}
        </main>
      )}

      {loadState === 'ready' && pendingFieldIds.length > 0 && (
        <PendingBar
          pendingCount={pendingFieldIds.length}
          isSendingAll={isSendingAll}
          onSendAll={() => {
            void handleSendAll();
          }}
          onDiscardAll={handleDiscardAll}
        />
      )}
    </div>
  );
}
