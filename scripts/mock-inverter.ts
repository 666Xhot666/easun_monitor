/**
 * Local simulator for an EASUN ISOLAR SMG-II behind a Wi-Fi Plug Pro logger:
 * the same UDP discovery handshake (port 58899) and framed Modbus TCP
 * protocol (port 8899) as the real device, so the app can be developed
 * without touching the inverter.
 *
 *   node scripts/mock-inverter.ts      (Node 22.18+ or 23.6+)
 *
 * Pair it in the setup wizard at host.docker.internal (Docker Desktop) or
 * your host's LAN IP (Docker on Linux), port 8899. Telemetry values drift
 * randomly on every read; settings keep their value and accept writes.
 *
 * To see alerts on the dashboard, start it with active fault or warning
 * bits, e.g. MOCK_FAULT_CODE=128 (output overload) or
 * MOCK_WARNING_CODE=16640 (battery low voltage + fan blocked). Start it
 * with MOCK_FAULT_MODE=1 to report fault mode until "Exit fault mode" is
 * sent.
 */
import { InMemoryLogger } from '../eam_server/src/inverter/link/in-memory-logger.ts';
import { startLoggerServer } from '../eam_server/src/inverter/link/logger-server.ts';
import {
  RegisterMap,
  wordCount,
  type RegisterDefinition,
} from '../eam_server/src/inverter/registers/register-map.ts';
import { SMG_II_REGISTERS } from '../eam_server/src/inverter/registers/smg-ii.registers.ts';

const map = new RegisterMap(SMG_II_REGISTERS);
const definitions = map.list();

const between = (min: number, max: number) => min + Math.random() * (max - min);

let faultMode = process.env.MOCK_FAULT_MODE === '1';

/** A plausible real-world value for a register, by what it measures. */
function realValue(definition: RegisterDefinition): number {
  const { name, unit } = definition;
  let value: number;
  if (name === 'FaultCode') value = Number(process.env.MOCK_FAULT_CODE ?? 0);
  else if (name === 'WarningCode') value = Number(process.env.MOCK_WARNING_CODE ?? 0);
  else if (name === 'OperationMode') value = faultMode ? 6 : 2; // Fault or Mains
  else if (definition.choices) value = definition.choices[Math.floor(Math.random() * definition.choices.length)];
  else if (definition.options) value = Math.floor(Math.random() * definition.options.length);
  else if (name === 'RatedPower') value = 3200;
  else if (name.includes('Soc')) value = between(40, 100);
  else if (name.includes('Frequency')) value = between(49.8, 50.2);
  else if (name.includes('Temperature')) value = between(25, 45);
  else if (unit === 'V' && (name.startsWith('Battery') || /Charging|Protection/.test(name))) {
    value = between(48, 57); // a 48 V bank and its charge/protection points
  } else if (unit === 'V') value = between(220, 240);
  else if (name === 'LoadPercentage') value = between(5, 60);
  else if (name.startsWith('BatteryCurrent')) value = between(-30, 40);
  else if (unit === 'A') value = between(0, 40);
  else if (unit === 'W' || unit === 'VA') value = between(0, 3200);
  else if (definition.min !== undefined && definition.max !== undefined) {
    value = between(definition.min, definition.max);
  } else value = 0;

  if (definition.min !== undefined) value = Math.max(definition.min, value);
  if (definition.max !== undefined) value = Math.min(definition.max, value);
  return value;
}

/** Raw register words for a real value, as the inverter would hold them. */
function toWords(definition: RegisterDefinition, value: number): number[] {
  const raw = Math.round(value / (definition.scale ?? 1));
  if (definition.type === 'uint32') return [Math.floor(raw / 0x10000) & 0xffff, raw & 0xffff];
  if (definition.type === 'int16') return [raw < 0 ? raw + 0x10000 : raw & 0xffff];
  return [Math.max(0, Math.min(0xffff, raw))];
}

/** The definition whose registers include `address`, if any. */
function definitionAt(address: number): RegisterDefinition | undefined {
  return definitions.find((d) => address >= d.address && address < d.address + wordCount(d));
}

const logger = new InMemoryLogger({
  isWritable: (address) => definitionAt(address)?.writable === true,
  // Telemetry is generated fresh on every read; settings and status were
  // seeded below, so they only change when written.
  valueFor: (address) => {
    const definition = definitionAt(address);
    if (!definition || definition.group !== 'telemetry') return 0;
    return toWords(definition, realValue(definition))[address - definition.address];
  },
  onWrite: (address, values) => {
    const name = definitionAt(address)?.name;
    console.log(`[mock-inverter] write ${name ?? address} = ${values.join(', ')}`);
    if (name === 'ExitFaultMode' && faultMode) {
      faultMode = false;
      console.log('[mock-inverter] left fault mode');
    }
  },
});

/** Text as register words: two characters per word, NUL padded. */
function textWords(definition: RegisterDefinition, text: string): number[] {
  const bytes = Buffer.alloc(wordCount(definition) * 2);
  bytes.write(text, 'latin1');
  return Array.from({ length: wordCount(definition) }, (_, i) => bytes.readUInt16BE(i * 2));
}

for (const definition of definitions) {
  if (definition.type === 'ascii') {
    logger.set(definition.address, textWords(definition, 'MOCK-SMG-0001'));
  } else if (definition.group !== 'telemetry') {
    logger.set(definition.address, toWords(definition, realValue(definition)));
  }
}

const server = await startLoggerServer({
  logger,
  tcpPort: 8899,
  udpPort: 58899,
  log: (message) => console.log(`[mock-inverter] ${message}`),
});
console.log('[mock-inverter] SMG-II simulator listening on UDP 58899 and TCP 8899. Ctrl+C to stop.');

async function shutdown(): Promise<void> {
  console.log('\n[mock-inverter] Shutting down');
  await server.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
