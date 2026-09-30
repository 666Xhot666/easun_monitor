import { isPrivateAddress, LoggerAddressPolicy } from './logger-address.policy';

describe('isPrivateAddress', () => {
  it.each([
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.50',
    '127.0.0.1',
    '169.254.10.10',
    '::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:192.168.1.50',
  ])('treats %s as private', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '172.32.0.1', '11.0.0.1', '192.169.0.1', '2001:4860::8888', '::ffff:8.8.8.8'])(
    'treats %s as public',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );
});

describe('LoggerAddressPolicy', () => {
  const lookup = (table: Record<string, string[]>) => async (host: string) => {
    const addresses = table[host];
    if (!addresses) throw new Error(`getaddrinfo ENOTFOUND ${host}`);
    return addresses;
  };

  it('allows private literal addresses without a DNS lookup', async () => {
    const policy = new LoggerAddressPolicy({ allowPublic: false, lookup: lookup({}) });
    await expect(policy.assertAllowed('192.168.1.50')).resolves.toBeUndefined();
  });

  it('refuses public literal addresses', async () => {
    const policy = new LoggerAddressPolicy({ allowPublic: false, lookup: lookup({}) });
    await expect(policy.assertAllowed('8.8.8.8')).rejects.toThrow(/private network/);
  });

  it('allows a hostname only when every address it resolves to is private', async () => {
    const policy = new LoggerAddressPolicy({
      allowPublic: false,
      lookup: lookup({
        'host.docker.internal': ['192.168.65.254'],
        'mixed.example': ['192.168.1.2', '93.184.216.34'],
      }),
    });
    await expect(policy.assertAllowed('host.docker.internal')).resolves.toBeUndefined();
    await expect(policy.assertAllowed('mixed.example')).rejects.toThrow(/private network/);
  });

  it('reports a hostname that does not resolve', async () => {
    const policy = new LoggerAddressPolicy({ allowPublic: false, lookup: lookup({}) });
    await expect(policy.assertAllowed('nowhere.lan')).rejects.toThrow(/could not be resolved/);
  });

  it('allows anything when public hosts are explicitly enabled', async () => {
    const policy = new LoggerAddressPolicy({ allowPublic: true, lookup: lookup({}) });
    await expect(policy.assertAllowed('8.8.8.8')).resolves.toBeUndefined();
  });
});
