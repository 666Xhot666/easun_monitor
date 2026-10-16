import { ServiceUnavailableException } from '@nestjs/common';
import { LOCATION_LOOKUP_URL } from './constants';
import { LocationService } from './location.service';

describe('LocationService', () => {
  const service = new LocationService();
  const answer = (body: unknown, status = 200) =>
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(body), { status }));

  afterEach(() => jest.restoreAllMocks());

  it("finds the server's location by its public address, rounded to about 10 km", async () => {
    const fetch = answer({ latitude: 12.3456, longitude: -45.678 });

    await expect(service.detect()).resolves.toEqual({
      latitude: 12.3,
      longitude: -45.7,
    });
    expect(fetch).toHaveBeenCalledWith(LOCATION_LOOKUP_URL, expect.anything());
  });

  it('says the location is unavailable when the lookup fails or knows nothing', async () => {
    for (const fail of [
      () => answer({ error: true, reason: 'RateLimited' }, 429),
      () => answer({ error: true, reason: 'Reserved IP Address' }),
      () => answer({ latitude: 'x' }),
      () => jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline')),
    ]) {
      fail();
      await expect(service.detect()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      jest.restoreAllMocks();
    }
  });
});
