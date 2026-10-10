import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { useAuth } from '../auth/useAuth';
import type { BatteryType, InverterProfile } from '../auth/types';
import { UserRoundCheck } from 'lucide-react';
import { BrandMark } from '../ui/BrandMark';

const STEP_LABELS = ['Network & Connection', 'Inverter & Power Rating', 'Battery Bank Specs'];

const POWER_PRESETS_W = [3600, 5000, 6200];

const BATTERY_TYPE_OPTIONS: { value: BatteryType; label: string }[] = [
  { value: 'LIFEPO4', label: 'LiFePO4' },
  { value: 'LEAD_ACID', label: 'Lead-Acid (flooded)' },
  { value: 'GEL', label: 'GEL' },
  { value: 'USER_DEFINED', label: 'Other / user-defined' },
];

const VOLTAGE_PRESETS = [12, 24, 48];

interface PairTestResult {
  success: true;
  latencyMs: number;
  sampledParameter: string;
}

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'success'; result: PairTestResult }
  | { status: 'error'; message: string };

function inputClasses() {
  return 'mt-1 block w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent';
}

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <ol className="mt-6 mb-8 flex items-center justify-between">
      {STEP_LABELS.map((label, index) => {
        const step = index + 1;
        const isActive = step === currentStep;
        const isDone = step < currentStep;
        return (
          <li key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={
                  'flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ' +
                  (isDone
                    ? 'bg-ink text-page'
                    : isActive
                      ? 'border-2 border-ink text-ink'
                      : 'border-2 border-line-strong text-muted')
                }
              >
                {isDone ? '✓' : step}
              </div>
              <span
                className={
                  'hidden text-center text-xs sm:block ' +
                  (isActive
                    ? 'font-medium text-ink'
                    : 'text-muted')
                }
              >
                {label}
              </span>
            </div>
            {step < STEP_LABELS.length && (
              <div
                className={
                  'mx-2 h-0.5 flex-1 ' + (isDone ? 'bg-ink' : 'bg-surface-2')
                }
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default function SetupWizard() {
  const navigate = useNavigate();
  const { refreshUser, user, logout } = useAuth();
  const hasExistingProfiles = (user?.inverterProfiles.length ?? 0) > 0;

  const [step, setStep] = useState(1);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // --- Step 1 ---
  const [name, setName] = useState('My Inverter');
  const [ipAddress, setIpAddress] = useState('');
  const [port, setPort] = useState('8899');
  const [testState, setTestState] = useState<TestState>({ status: 'idle' });

  // --- Step 2 ---
  const [ratedPowerPreset, setRatedPowerPreset] = useState<string>(String(POWER_PRESETS_W[0]));
  const [customRatedPower, setCustomRatedPower] = useState('');

  // --- Step 3 ---
  const [batteryNominalVoltage, setBatteryNominalVoltage] = useState<string>('48');
  const [batteryCapacityAh, setBatteryCapacityAh] = useState('200');
  const [batteryType, setBatteryType] = useState<BatteryType>('LIFEPO4');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [lowBatteryCutoffVoltage, setLowBatteryCutoffVoltage] = useState('');
  const [bulkChargeVoltage, setBulkChargeVoltage] = useState('');
  const [floatChargeVoltage, setFloatChargeVoltage] = useState('');

  const ratedPowerWatts =
    ratedPowerPreset === 'custom' ? customRatedPower : ratedPowerPreset;

  // Accepts a dotted IPv4 address OR a hostname (e.g. host.docker.internal
  // for pairing scripts/mock-inverter.ts during local development) — kept
  // in sync with the backend's HOST_ADDRESS_PATTERN in
  // eam_server/src/common/validators/host-address.ts.
  const isIpValid =
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(
      ipAddress.trim(),
    );
  const canLeaveStep1 = name.trim().length > 0 && isIpValid;
  const canLeaveStep2 = Number(ratedPowerWatts) > 0;
  const canSubmit =
    Number(batteryNominalVoltage) > 0 && Number(batteryCapacityAh) > 0;

  async function handleVerifyLogger() {
    setTestState({ status: 'testing' });
    try {
      const { data } = await axios.post<PairTestResult>('/api/inverter/pair/test', {
        ipAddress: ipAddress.trim(),
        port: Number(port) || 8899,
      });
      setTestState({ status: 'success', result: data });
    } catch (err) {
      setTestState({
        status: 'error',
        message: extractErrorMessage(err, "Couldn't reach the logger at that address."),
      });
    }
  }

  async function handleFinish() {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const { data: created } = await axios.post<InverterProfile>('/api/inverter/setup', {
        name: name.trim(),
        ipAddress: ipAddress.trim(),
        port: Number(port) || 8899,
        ratedPowerWatts: Number(ratedPowerWatts),
        batteryNominalVoltage: Number(batteryNominalVoltage),
        batteryCapacityAh: Number(batteryCapacityAh),
        batteryType,
        ...(lowBatteryCutoffVoltage
          ? { lowBatteryCutoffVoltage: Number(lowBatteryCutoffVoltage) }
          : {}),
        ...(bulkChargeVoltage ? { bulkChargeVoltage: Number(bulkChargeVoltage) } : {}),
        ...(floatChargeVoltage ? { floatChargeVoltage: Number(floatChargeVoltage) } : {}),
      });
      await refreshUser();
      // Straight to the inverter that was just paired, not whichever one
      // the dashboard would otherwise default to — matters once a user
      // has more than one and is adding another.
      navigate(`/dashboard/${created.id}`, { replace: true });
    } catch (err) {
      setSubmitError(extractErrorMessage(err, 'Could not save your inverter setup — please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  // Invited users have no household of their own: the server refuses them.
  if (user && user.adminHouseholdId === null) {
    if (!hasExistingProfiles) {
      const household = user.households[0];
      return (
        <div className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
          <div className="w-full max-w-md rounded-xl border border-line bg-surface p-8 shadow-sm">
            <BrandMark />
            <UserRoundCheck className="h-7 w-7 text-muted" />
            <h1 className="mt-3 text-xl font-semibold">Waiting for your admin to add an inverter</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              You joined {household?.name ?? 'a household'} as a reader. When a household admin pairs an inverter, it appears here
              automatically.
            </p>
            <button
              type="button"
              onClick={logout}
              className="mt-6 h-10 rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-surface-2"
            >
              Sign out
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
        <div className="w-full max-w-lg rounded-xl border border-line bg-surface p-8 text-sm text-ink shadow-sm">
          <p>Only a household admin can add inverters. Ask an admin of your household to add one.</p>
          <Link to="/dashboard" className="mt-4 inline-block font-medium text-accent hover:underline">
            Back to the dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-lg rounded-xl border border-line bg-surface p-8 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-ink">
              {hasExistingProfiles ? 'Pair another inverter' : 'Pair your inverter'}
            </h1>
            <p className="mt-1 text-sm text-muted">
              Signed in as {user?.email}. This tells EAM how to read and interpret this
              system's telemetry.
            </p>
          </div>
          {hasExistingProfiles && (
            <Link
              to="/dashboard"
              className="shrink-0 text-sm font-medium text-accent hover:underline"
            >
              Back to dashboard
            </Link>
          )}
        </div>

        <StepIndicator currentStep={step} />

        {step === 1 && (
          <div className="space-y-4">
            <Field label="Profile name" htmlFor="name">
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClasses()}
                placeholder="e.g. Cabin Inverter"
              />
            </Field>

            <Field
              label="Logger IP address"
              htmlFor="ipAddress"
              hint="The Wi-Fi logger's address on your network (e.g. 192.168.1.50). Find it in your router's device list or in the SmartESS app."
            >
              <input
                id="ipAddress"
                type="text"
                value={ipAddress}
                onChange={(e) => {
                  setIpAddress(e.target.value);
                  setTestState({ status: 'idle' });
                }}
                className={inputClasses()}
                placeholder="192.168.1.50"
              />
            </Field>

            <Field label="Port" htmlFor="port" hint="Leave as 8899 unless you know it's been changed.">
              <input
                id="port"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className={inputClasses()}
              />
            </Field>

            <div>
              <button
                type="button"
                onClick={handleVerifyLogger}
                disabled={!isIpValid || testState.status === 'testing'}
                className="rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {testState.status === 'testing' ? 'Verifying…' : 'Verify Logger'}
              </button>

              {testState.status === 'success' && (
                <p className="mt-2 text-sm text-emerald-600">
                  Connected — read {testState.result.sampledParameter} in{' '}
                  {testState.result.latencyMs}ms.
                </p>
              )}
              {testState.status === 'error' && (
                <p className="mt-2 text-sm text-crit-ink">{testState.message}</p>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <Field label="Rated inverter power" htmlFor="ratedPower" hint="Used to compute true load utilization %.">
              <select
                id="ratedPower"
                value={ratedPowerPreset}
                onChange={(e) => setRatedPowerPreset(e.target.value)}
                className={inputClasses()}
              >
                {POWER_PRESETS_W.map((watts) => (
                  <option key={watts} value={watts}>
                    {(watts / 1000).toFixed(1)} kW ({watts} W)
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>
            </Field>

            {ratedPowerPreset === 'custom' && (
              <Field label="Custom rated power (W)" htmlFor="customRatedPower">
                <input
                  id="customRatedPower"
                  type="number"
                  min={1}
                  value={customRatedPower}
                  onChange={(e) => setCustomRatedPower(e.target.value)}
                  className={inputClasses()}
                  placeholder="e.g. 4500"
                />
              </Field>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <Field label="Nominal battery bank voltage" htmlFor="batteryVoltage">
              <select
                id="batteryVoltage"
                value={batteryNominalVoltage}
                onChange={(e) => setBatteryNominalVoltage(e.target.value)}
                className={inputClasses()}
              >
                {VOLTAGE_PRESETS.map((v) => (
                  <option key={v} value={v}>
                    {v}V
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Battery chemistry" htmlFor="batteryType">
              <select
                id="batteryType"
                value={batteryType}
                onChange={(e) => setBatteryType(e.target.value as BatteryType)}
                className={inputClasses()}
              >
                {BATTERY_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Battery capacity (Ah)" htmlFor="batteryCapacityAh" hint="Used to estimate stored energy in kWh.">
              <input
                id="batteryCapacityAh"
                type="number"
                min={1}
                value={batteryCapacityAh}
                onChange={(e) => setBatteryCapacityAh(e.target.value)}
                className={inputClasses()}
              />
            </Field>

            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-sm font-medium text-accent hover:underline"
            >
              {showAdvanced ? 'Hide' : 'Show'} voltage threshold overrides (optional)
            </button>

            {showAdvanced && (
              <div className="space-y-4 rounded-lg border border-line p-4">
                <Field label="Low battery cutoff voltage" htmlFor="lowCutoff" hint="Leave blank to use the chemistry default.">
                  <input
                    id="lowCutoff"
                    type="number"
                    step="0.1"
                    value={lowBatteryCutoffVoltage}
                    onChange={(e) => setLowBatteryCutoffVoltage(e.target.value)}
                    className={inputClasses()}
                  />
                </Field>
                <Field label="Bulk charge voltage" htmlFor="bulkCharge">
                  <input
                    id="bulkCharge"
                    type="number"
                    step="0.1"
                    value={bulkChargeVoltage}
                    onChange={(e) => setBulkChargeVoltage(e.target.value)}
                    className={inputClasses()}
                  />
                </Field>
                <Field label="Float charge voltage" htmlFor="floatCharge">
                  <input
                    id="floatCharge"
                    type="number"
                    step="0.1"
                    value={floatChargeVoltage}
                    onChange={(e) => setFloatChargeVoltage(e.target.value)}
                    className={inputClasses()}
                  />
                </Field>
              </div>
            )}

            {submitError && (
              <p className="rounded-lg bg-crit-bg px-3 py-2 text-sm text-crit-ink">
                {submitError}
              </p>
            )}
          </div>
        )}

        <div className="mt-8 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-0"
          >
            Back
          </button>

          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={step === 1 ? !canLeaveStep1 : !canLeaveStep2}
              className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-page transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                void handleFinish();
              }}
              disabled={!canSubmit || isSubmitting}
              className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-page transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Saving…' : 'Finish setup'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
