import { BadRequestException } from '@nestjs/common';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface LoggerAddressPolicyOptions {
  /** ALLOW_PUBLIC_LOGGER_HOSTS=true: skip the private-network check. */
  allowPublic: boolean;
  /** Resolves a hostname to every address it maps to. */
  lookup?: (host: string) => Promise<string[]>;
}

const defaultLookup = async (host: string): Promise<string[]> =>
  (await dnsLookup(host, { all: true })).map((entry) => entry.address);

/**
 * Decides which hosts the server may open UDP/TCP connections to on a
 * user's behalf (pairing check and polling). Loggers live on the home LAN,
 * so by default only private, loopback and link-local addresses are
 * allowed; otherwise any account could use the server to probe arbitrary
 * hosts. A hostname is allowed only if everything it resolves to is.
 */
export class LoggerAddressPolicy {
  private readonly allowPublic: boolean;
  private readonly lookup: (host: string) => Promise<string[]>;

  constructor(options: LoggerAddressPolicyOptions) {
    this.allowPublic = options.allowPublic;
    this.lookup = options.lookup ?? defaultLookup;
  }

  /** Throws BadRequestException with a user-facing message when refused. */
  async assertAllowed(host: string): Promise<void> {
    if (this.allowPublic) return;

    let addresses: string[];
    if (isIP(host)) {
      addresses = [host];
    } else {
      try {
        addresses = await this.lookup(host);
      } catch {
        throw new BadRequestException(`The logger address ${host} could not be resolved`);
      }
    }

    if (addresses.length === 0 || !addresses.every(isPrivateAddress)) {
      throw new BadRequestException(
        `The logger address ${host} is not on a private network. ` +
          `Use the logger's LAN address, or set ALLOW_PUBLIC_LOGGER_HOSTS=true.`,
      );
    }
  }
}

/** RFC 1918, loopback, link-local and IPv6 unique-local/link-local. */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPrivateAddress(mapped[1]);

  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === '::1' ||
      /^f[cd][0-9a-f]{0,2}:/.test(normalized) ||
      /^fe[89ab][0-9a-f]?:/.test(normalized)
    );
  }
  return false;
}
