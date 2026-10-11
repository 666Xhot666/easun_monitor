import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { hashIngestToken, newIngestToken } from '../bms/ingest-token';
import { HouseholdsService } from '../households/households.service';
import { PrismaService } from '../prisma/prisma.service';
import type { PutOutageSourceDto } from './dto/put-outage-source.dto';
import type { PutSiteStreetsDto } from './dto/put-site-streets.dto';
import { localized } from '../i18n/localized';

/** The only DTEK site so far: DTEK Dnipro. */
const SITE = 'dnem';

/** Everything about a source but its token hash. */
const SOURCE_FIELDS = {
  id: true,
  site: true,
  city: true,
  street: true,
  house: true,
  enabled: true,
  houseState: true,
  groups: true,
  lastSeenAt: true,
} as const;

const byUkrainian = new Intl.Collator('uk').compare;

/** A check asked for in the app comes at most this often. */
const REFRESH_EVERY_MS = 5 * 60_000;

@Injectable()
export class OutageSourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly households: HouseholdsService,
  ) {}

  async get(profileId: number, userId: number) {
    await this.households.requireProfile(profileId, userId, 'read');
    const source = await this.prisma.outageSource.findUnique({
      where: { inverterProfileId: profileId },
      select: SOURCE_FIELDS,
    });
    return { source };
  }

  /**
   * Creates the source, returning the reader token (the only time it is
   * shown), or changes it. A new address is looked up again by the reader,
   * so its groups are cleared until then.
   */
  async put(profileId: number, userId: number, dto: PutOutageSourceDto) {
    await this.households.requireProfile(profileId, userId, 'write');
    await this.checkAddress(dto.city, dto.street);
    const { city, street, house } = dto;

    const existing = await this.prisma.outageSource.findUnique({
      where: { inverterProfileId: profileId },
    });
    if (!existing) {
      const { token, hash } = newIngestToken();
      const source = await this.prisma.outageSource.create({
        data: {
          inverterProfileId: profileId,
          site: SITE,
          city,
          street,
          house,
          enabled: dto.enabled ?? true,
          tokenHash: hash,
        },
        select: SOURCE_FIELDS,
      });
      return { source, token };
    }

    const moved =
      existing.city !== city ||
      existing.street !== street ||
      existing.house !== house;
    const source = await this.prisma.outageSource.update({
      where: { id: existing.id },
      data: {
        city,
        street,
        house,
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
        ...(moved && { houseState: 'PENDING', groups: [] }),
      },
      select: SOURCE_FIELDS,
    });
    return { source };
  }

  async replaceToken(profileId: number, userId: number) {
    await this.households.requireProfile(profileId, userId, 'write');
    const { token, hash } = newIngestToken();
    const { count } = await this.prisma.outageSource.updateMany({
      where: { inverterProfileId: profileId },
      data: { tokenHash: hash },
    });
    if (count === 0) throw new NotFoundException('No outage source here');
    return { token };
  }

  async remove(profileId: number, userId: number): Promise<void> {
    await this.households.requireProfile(profileId, userId, 'write');
    const { count } = await this.prisma.outageSource.deleteMany({
      where: { inverterProfileId: profileId },
    });
    if (count === 0) throw new NotFoundException('No outage source here');
  }

  /** The address a reader token is for, noting that the reader was seen. */
  async sourceForToken(token: string) {
    const source = await this.prisma.outageSource.findUnique({
      where: { tokenHash: hashIngestToken(token) },
    });
    if (!source) return null;
    await this.prisma.outageSource.update({
      where: { id: source.id },
      data: { lastSeenAt: new Date() },
    });
    const { site, city, street, house, enabled } = source;
    const refresh =
      enabled &&
      source.refreshRequestedAt !== null &&
      (await this.pending(source.id, source.refreshRequestedAt));
    return { site, city, street, house, enabled, refresh };
  }

  /**
   * Asks the reader for a check now (it asks the server every minute). At
   * most one every 5 minutes, counted from the last check.
   */
  async requestRefresh(profileId: number, userId: number, now = new Date()) {
    await this.households.requireProfile(profileId, userId, 'read');
    const source = await this.prisma.outageSource.findUnique({
      where: { inverterProfileId: profileId },
    });
    if (!source) throw new NotFoundException('No outage source here');
    if (!source.enabled) {
      throw new ConflictException(localized('checkingOff'));
    }
    if (
      source.refreshRequestedAt &&
      (await this.pending(source.id, source.refreshRequestedAt))
    ) {
      return { requestedAt: source.refreshRequestedAt };
    }
    const last = await this.lastCheck(source.id);
    const age = last ? now.getTime() - last.checkedAt.getTime() : Infinity;
    if (age < REFRESH_EVERY_MS) {
      const ago = Math.floor(age / 60_000);
      const wait = Math.ceil((REFRESH_EVERY_MS - age) / 60_000);
      throw new HttpException(
        localized('checkedRecently', { ago, wait }),
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.prisma.outageSource.update({
      where: { id: source.id },
      data: { refreshRequestedAt: now },
    });
    return { requestedAt: now };
  }

  /** Whether a check asked for at `requestedAt` is still to come. */
  private async pending(sourceId: number, requestedAt: Date) {
    const last = await this.lastCheck(sourceId);
    return !last || last.checkedAt < requestedAt;
  }

  private lastCheck(sourceId: number) {
    return this.prisma.outageCheck.findFirst({
      where: { sourceId },
      orderBy: { checkedAt: 'desc' },
      select: { checkedAt: true },
    });
  }

  /** Stores the site's city -> streets list, unless it is unchanged. */
  async saveStreets(dto: PutSiteStreetsDto): Promise<{ changed: boolean }> {
    const valid = Object.values(dto.streets).every(
      (list) => Array.isArray(list) && list.every((s) => typeof s === 'string'),
    );
    if (!valid) {
      throw new BadRequestException('streets must map cities to street names');
    }
    const hash = createHash('sha256')
      .update(JSON.stringify(dto.streets))
      .digest('hex');
    const existing = await this.prisma.outageSiteStreets.findUnique({
      where: { site: dto.site },
      select: { hash: true },
    });
    if (existing?.hash === hash) return { changed: false };
    await this.prisma.outageSiteStreets.upsert({
      where: { site: dto.site },
      create: { site: dto.site, streets: dto.streets, hash },
      update: { streets: dto.streets, hash },
    });
    return { changed: true };
  }

  /** The site's cities, alphabetically; empty until the reader sent them. */
  async cities(): Promise<string[]> {
    const streets = await this.siteStreets();
    return streets ? Object.keys(streets).sort(byUkrainian) : [];
  }

  async streets(city: string): Promise<string[]> {
    const list = (await this.siteStreets())?.[city];
    if (!list) throw new NotFoundException(localized('noSuchCity'));
    return list;
  }

  private async siteStreets(): Promise<Record<string, string[]> | null> {
    const row = await this.prisma.outageSiteStreets.findUnique({
      where: { site: SITE },
    });
    return row ? (row.streets as Record<string, string[]>) : null;
  }

  /**
   * City and street must be on the site's list, once the reader has sent it;
   * before that (the reader's first run needs the token) they are taken as
   * typed, and a wrong one shows up as a house that is not found.
   */
  private async checkAddress(city: string, street: string): Promise<void> {
    const streets = await this.siteStreets();
    if (!streets) return;
    if (!streets[city]) {
      throw new BadRequestException(localized('cityNotListed', { city }));
    }
    if (!streets[city].includes(street)) {
      throw new BadRequestException(
        localized('streetNotListed', { street, city }),
      );
    }
  }
}
