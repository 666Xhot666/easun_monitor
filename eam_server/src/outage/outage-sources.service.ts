import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { hashIngestToken, newIngestToken } from '../bms/ingest-token';
import { HouseholdsService } from '../households/households.service';
import { PrismaService } from '../prisma/prisma.service';
import type { PutOutageSourceDto } from './dto/put-outage-source.dto';
import type { PutSiteStreetsDto } from './dto/put-site-streets.dto';

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
    return { site, city, street, house, enabled };
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
    if (!list) throw new NotFoundException('No such city on the site');
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
      throw new BadRequestException(`${city} is not on the site's list`);
    }
    if (!streets[city].includes(street)) {
      throw new BadRequestException(
        `${street} is not on the site's list for ${city}`,
      );
    }
  }
}
