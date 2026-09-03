import { Controller, Get, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Capped rather than unbounded — this backs a chart, not a full export, and
// an unbounded `findMany` would grow linearly with how long the poller has
// been running.
const HISTORY_LIMIT = 100;

@Controller('api/inverter')
export class InverterController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Most recent polled snapshot. 404s (rather than returning null) when no
   * row exists yet — e.g. right after a fresh deploy, before the first
   * poll cycle has completed — so the frontend can tell "no data yet"
   * apart from "couldn't reach the API at all".
   */
  @Get('latest')
  async getLatest() {
    const latest = await this.prisma.inverterLog.findFirst({
      orderBy: { timestamp: 'desc' },
    });

    if (!latest) {
      throw new NotFoundException('No inverter readings recorded yet');
    }

    return latest;
  }

  /**
   * Last `HISTORY_LIMIT` snapshots, chronological (oldest → newest) so a
   * chart can plot the array directly without re-sorting. The query itself
   * has to sort descending to grab the *most recent* rows with `take`;
   * `.reverse()` afterwards is what flips it back to chronological order.
   */
  @Get('history')
  async getHistory() {
    const rows = await this.prisma.inverterLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: HISTORY_LIMIT,
    });

    return rows.reverse();
  }
}
