import { Injectable, Logger } from '@nestjs/common';
import { InverterReading } from './interfaces/inverter-reading.interface';

/**
 * Speaks the reverse-engineered UDP/Modbus TCP protocol to the EASUN
 * ISOLAR SMX-II's Wi-Fi dongle. This is the single seam where that protocol
 * logic lives — PollingService and everything else only ever depend on the
 * `fetchDeviceData` contract, never on the wire format underneath it.
 */
@Injectable()
export class InverterService {
  private readonly logger = new Logger(InverterService.name);

  /**
   * Opens a connection to the inverter at `ipAddress`, requests a telemetry
   * snapshot, and returns it decoded.
   *
   * @throws Error whenever a reading can't be produced — the device is
   * unreachable, the Wi-Fi plug drops mid-exchange, the response times out,
   * or the payload fails to parse. Callers (PollingService) are responsible
   * for catching this; this method never returns a partial/invalid reading.
   */
  async fetchDeviceData(ipAddress: string): Promise<InverterReading> {
    if (!ipAddress) {
      throw new Error('fetchDeviceData: no inverter IP address provided');
    }

    this.logger.debug(`Fetching telemetry from inverter at ${ipAddress}`);

    // TODO: replace with the real reverse-engineered UDP/Modbus TCP exchange
    // (open socket -> send request frame -> await response -> decode
    // registers into an InverterReading). Until that lands, this placeholder
    // always fails the way a dropped Wi-Fi connection would, so
    // PollingService's error handling is exercised end-to-end from day one.
    throw new Error(
      `Lost connection to inverter at ${ipAddress}: Modbus/UDP client not implemented yet`,
    );
  }
}
