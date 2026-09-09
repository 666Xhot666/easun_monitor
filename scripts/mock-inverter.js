#!/usr/bin/env node
'use strict';

/**
 * mock-inverter.js
 *
 * Standalone local simulator for the EASUN ISOLAR SMX-II's "Wi-Fi Plug
 * Pro" adapter — the exact reverse-engineered UDP discovery + proprietary
 * Modbus TCP/RTU framing that eam_server's InverterService speaks. Zero
 * npm dependencies (native dgram/net/fs/path only), so you can run it
 * standalone instead of touching the real inverter or the SmartESS app
 * while building the web UI:
 *
 *   node scripts/mock-inverter.js
 *
 * --- Pointing the backend at this instead of the real inverter ---
 * There's no .env setting for this anymore — every inverter (real or
 * mocked) is paired per-account through the in-app setup wizard, not a
 * global address in .env with no owning user. So: register/log in, then
 * in the wizard's "Logger IP address" field, use whichever of these
 * resolves to your host machine from *inside* the `server` container
 * (that's what actually opens the socket, not your browser):
 *   - Docker Desktop (Mac/Windows): host.docker.internal
 *   - Docker on Linux: your host machine's LAN/bridge IP, or run
 *     `docker compose exec server getent hosts host.docker.internal`
 *     if extra_hosts: host-gateway is configured and you want the
 *     resolved numeric address instead
 * Leave Port at 8899, since that's what this script listens on below.
 *
 * --- A note on register addresses ---
 * This script loads the real commands.json (the same file InverterService
 * reads) to generate a plausible value for every one of the ~85 registers
 * actually polled each cycle, keyed off each register's real name — not
 * just the two addresses called out below. Worth knowing: in the real
 * file, e204 is actually "OutputPriority" (an enum) and e205 is
 * "MaxACChargerCurrent", not GridVoltage/Battery — the real
 * voltage/current/SoC registers live at 0213 (LineVoltage), 0101
 * (BatteryVoltage), 0100 (BatterySoc), 0109 (PVPower), etc. This script
 * still special-cases e204/e205 exactly as specified below (so a request
 * against those specific addresses is predictable for quick manual
 * testing), while every other register — including the real
 * voltage/current/SoC ones — gets a realistic value derived from its
 * actual name and type, so the full dynamic polling loop gets sensible
 * data end to end instead of random noise for the other ~83 registers.
 */

const dgram = require('node:dgram');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');

const UDP_DISCOVERY_PORT = 58899;
const TCP_PORT = 8899;
const REQUEST_LENGTH = 16; // every real request is a fixed 16 bytes (single-register reads only)

// ---------------------------------------------------------------------
// CRC-16/MODBUS (polynomial 0xA001, initial value 0xFFFF), returned
// low-byte-first — identical algorithm to InverterService.calculateCrc16
// in eam_server, so a response built with this passes the real client's
// strict CRC check, and we can validate incoming requests the same way.
// ---------------------------------------------------------------------
function calculateCrc16(buffer) {
  let crc = 0xffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
    }
  }
  return Buffer.from([crc & 0xff, (crc >> 8) & 0xff]);
}

// ---------------------------------------------------------------------
// Realistic per-register mock values, driven off the real commands.json.
// ---------------------------------------------------------------------
const commandsPath = path.join(__dirname, '..', 'eam_server', 'src', 'inverter', 'commands.json');
let parameterDefinitions = [];
try {
  const commandsData = JSON.parse(fs.readFileSync(commandsPath, 'utf8'));
  const getSmxParamCommand = commandsData.commands.find((c) => c.name === 'get_smx_param');
  parameterDefinitions = (getSmxParamCommand && getSmxParamCommand.definition) || [];
  console.log(`[mock-inverter] Loaded ${parameterDefinitions.length} register definitions from commands.json`);
} catch (error) {
  console.warn(
    `[mock-inverter] Could not load commands.json (${error.message}) — every register will get a ` +
      `flat random value instead of a name-appropriate one.`,
  );
}

// Matched by substring against the register's real name (first match
// wins). Values are realistic ballparks for an EASUN ISOLAR SMX-II, not
// a calibration reference — this is a UI-development aid.
const NAME_RANGE_RULES = [
  [/soc/i, [40, 100]], // %
  [/frequency/i, [495, 505]], // tenths/hundredths of Hz depending on rate -> ~49.5-50.5Hz after scaling
  [/temperature/i, [180, 420]], // tenths of a degree C -> ~18-42°C
  [/voltage/i, [2150, 2450]], // tenths of a volt -> ~215-245V
  [/power/i, [0, 3000]], // W
  [/(percent|ratio|load)/i, [0, 100]], // %
  [/current/i, [0, 150]], // tenths of an amp (overridden below for signed current registers)
];

function findDefinition(hexAddress) {
  const normalized = hexAddress.toLowerCase();
  return parameterDefinitions.find((d) => (d.address || '').toLowerCase() === normalized);
}

function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

function jitterAround(baseline, spreadFraction) {
  return baseline * (1 + (Math.random() - 0.5) * spreadFraction);
}

function logicalValueForRegister(hexAddress, definition) {
  const normalized = hexAddress.toLowerCase();

  // Requirement examples, honored literally regardless of what
  // commands.json actually maps these two addresses to (see file header)
  // — small live-looking jitter around 2300 / 500.
  if (normalized === 'e204') return jitterAround(2300, 0.03);
  if (normalized === 'e205') return jitterAround(500, 0.03);

  if (!definition) {
    return Math.floor(Math.random() * 1000);
  }

  // Enum/state/on-off registers: a valid index into their own label
  // list, not a magnitude — e.g. BatteryType, ChargerSourcePriority.
  if (Array.isArray(definition.unit)) {
    return Math.floor(Math.random() * definition.unit.length);
  }

  // Signed current registers (BatteryCurrent, ChargeCurrentByLine) can
  // legitimately go negative (discharging vs. charging) — this is the
  // one case worth exercising InverterService's toSigned16 conversion
  // with an actual negative reading instead of always-positive noise.
  if (definition.type === 'Int16BE' && /current/i.test(definition.name)) {
    return randomInRange(-80, 150);
  }

  // Battery bank voltage (the live BatteryVoltage reading, every
  // Battery*Voltage charge/alarm setpoint, and the nominal-voltage
  // model register) is handled before the generic /voltage/i rule
  // below. A plain substring match on "voltage" would otherwise put
  // these in the ~215-245V range meant for AC line/output voltage —
  // exactly the "battery voltage displays as 243.8" bug: BatteryVoltage
  // has rate 0.1, so a raw ~2438 (picked as if it were an AC voltage)
  // scales to 243.8V instead of a realistic ~40-58V battery-bank
  // reading. Dividing by the field's own rate keeps this correct
  // whether that rate is 0.1 (BatteryVoltage), 0.2 (the E0xx charge/
  // alarm setpoints), or unscaled (ModelBatteryVoltage).
  if (/battery.*voltage/i.test(definition.name)) {
    const rate =
      typeof definition.rate === 'number' && definition.rate > 0 ? definition.rate : 1;
    return randomInRange(40, 58) / rate;
  }

  const rule = NAME_RANGE_RULES.find(([pattern]) => pattern.test(definition.name));
  if (rule) {
    const [min, max] = rule[1];
    return randomInRange(min, max);
  }

  return Math.floor(Math.random() * 1000);
}

/** Returns the raw unsigned 16-bit wire value to put on the response. */
function mockValueForRegister(hexAddress) {
  const definition = findDefinition(hexAddress);
  const rounded = Math.round(logicalValueForRegister(hexAddress, definition));

  if (rounded < 0) {
    return (0x10000 + rounded) & 0xffff; // two's-complement wire encoding for a negative Int16BE reading
  }
  return Math.max(0, Math.min(0xffff, rounded));
}

// ---------------------------------------------------------------------
// 1. UDP discovery server (port 58899)
// ---------------------------------------------------------------------
const udpServer = dgram.createSocket('udp4');

udpServer.on('message', (message, remote) => {
  const text = message.toString('utf8');
  if (!text.startsWith('set>server=')) {
    return;
  }

  console.log(`[mock-inverter] UDP handshake from ${remote.address}:${remote.port} -> "${text.trim()}"`);
  const reply = Buffer.from('rsp>server=1;', 'utf8');
  udpServer.send(reply, remote.port, remote.address, (error) => {
    if (error) {
      console.error(`[mock-inverter] Failed to send UDP handshake reply: ${error.message}`);
    }
  });
});

udpServer.on('error', (error) => {
  console.error(`[mock-inverter] UDP server error: ${error.message}`);
});

udpServer.bind(UDP_DISCOVERY_PORT, () => {
  console.log(`[mock-inverter] UDP discovery server listening on 0.0.0.0:${UDP_DISCOVERY_PORT}`);
});

// ---------------------------------------------------------------------
// 2 & 3. TCP Modbus server (port 8899) — parses requests, verifies the
// request CRC, and returns a strictly CRC-correct response.
// ---------------------------------------------------------------------
const tcpServer = net.createServer((socket) => {
  const remote = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`[mock-inverter] TCP client connected: ${remote}`);

  let buffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    // Every real request is exactly REQUEST_LENGTH bytes (single-register
    // reads only, matching InverterService.buildModbusPacket's default
    // dataLength of '0001') — but TCP is a byte stream, so don't assume
    // one `data` event is exactly one request.
    while (buffer.length >= REQUEST_LENGTH) {
      const request = buffer.subarray(0, REQUEST_LENGTH);
      buffer = buffer.subarray(REQUEST_LENGTH);
      handleRequest(socket, request);
    }
  });

  socket.on('error', (error) => {
    console.error(`[mock-inverter] TCP socket error (${remote}): ${error.message}`);
  });

  socket.on('close', () => {
    console.log(`[mock-inverter] TCP client disconnected: ${remote}`);
  });
});

function handleRequest(socket, request) {
  // Request layout (0-indexed), matching InverterService.buildModbusPacket:
  //   [0:2] transaction id   [2:4] protocol id   [4:6] length
  //   [6] outer unit id (ff) [7] outer func code (04)
  //   [8] inner unit id (ff) [9] inner func code (03)
  //   [10:12] register address   [12:14] quantity (always 0001)
  //   [14:16] CRC-16/MODBUS over bytes [8:14], low-byte-first
  const transactionId = request.subarray(0, 2);
  const protocolId = request.subarray(2, 4);
  const registerAddress = request.subarray(10, 12);
  const innerFrame = request.subarray(8, 14);
  const expectedCrc = calculateCrc16(innerFrame);
  const actualCrc = request.subarray(14, 16);

  if (!expectedCrc.equals(actualCrc)) {
    console.warn(
      `[mock-inverter] Dropping request for register ${registerAddress.toString('hex')}: bad CRC ` +
        `(expected ${expectedCrc.toString('hex')}, got ${actualCrc.toString('hex')})`,
    );
    return;
  }

  const hexAddress = registerAddress.toString('hex');
  const definition = findDefinition(hexAddress);
  const value = mockValueForRegister(hexAddress);
  const label = definition ? definition.name : 'unknown';

  console.log(`[mock-inverter] read ${hexAddress} (${label}) -> ${value}`);

  socket.write(buildResponse(transactionId, protocolId, value));
}

function buildResponse(transactionId, protocolId, value) {
  // Response layout (0-indexed), matching InverterService.parseResponse:
  //   [0:2] transaction id (echoed)   [2:4] protocol id (echoed)
  //   [4:6] length = 0009 (bytes following the header)
  //   [6] outer unit id (ff) [7] outer func code (04) — echo of the outer wrapper
  //   [8] inner unit id (01) [9] inner func code (03) — the real Modbus RTU reply,
  //       distinct from the outer wrapper's 0xff/0x04, matching real hardware captures
  //   [10] byte count (02, one register) [11:13] the 16-bit value
  //   [13:15] CRC-16/MODBUS over bytes [8:13], low-byte-first
  const innerReply = Buffer.from([
    0x01, // inner unit id
    0x03, // inner function code ("Read Holding Registers" reply)
    0x02, // byte count
    (value >> 8) & 0xff,
    value & 0xff,
  ]);
  const crc = calculateCrc16(innerReply);

  const payload = Buffer.concat([Buffer.from([0xff, 0x04]), innerReply, crc]);

  const header = Buffer.alloc(6);
  transactionId.copy(header, 0);
  protocolId.copy(header, 2);
  header.writeUInt16BE(payload.length, 4);

  return Buffer.concat([header, payload]);
}

tcpServer.on('error', (error) => {
  console.error(`[mock-inverter] TCP server error: ${error.message}`);
});

tcpServer.listen(TCP_PORT, () => {
  console.log(`[mock-inverter] TCP Modbus server listening on 0.0.0.0:${TCP_PORT}`);
  console.log('[mock-inverter] EASUN ISOLAR SMX-II / Wi-Fi Plug Pro simulator ready. Press Ctrl+C to stop.');
});

function shutdown() {
  console.log('\n[mock-inverter] Shutting down...');
  udpServer.close();
  tcpServer.close(() => process.exit(0));
  // Force-exit if any lingering TCP client connection keeps the server open.
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
