import { Injectable } from '@nestjs/common';
import { hashIngestToken, newIngestToken } from '../bms/ingest-token';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { HostSample } from '../server-agent/sample';
import { ServerAccessService } from './server-access.service';

/** Without a sample for this long, the server page says the agent is silent. */
export const AGENT_STALE_MS = 3 * 60_000;

/** The server agent's token, its samples, and the latest one for the server page. */
@Injectable()
export class ServerAgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ServerAccessService,
  ) {}

  /** A new agent token, shown once; the old one stops working. */
  async newToken(ownerId: number): Promise<{ token: string }> {
    await this.access.requireOwner(ownerId);
    const { token, hash } = newIngestToken();
    await this.prisma.serverAgent.upsert({
      where: { id: 1 },
      create: { id: 1, tokenHash: hash },
      update: { tokenHash: hash, lastSeenAt: null },
    });
    return { token };
  }

  /** Whether `token` is the agent's, noting that it was seen. */
  async isAgent(token: string): Promise<boolean> {
    const { count } = await this.prisma.serverAgent.updateMany({
      where: { tokenHash: hashIngestToken(token) },
      data: { lastSeenAt: new Date() },
    });
    return count > 0;
  }

  /** Stores a sample; one re-sent (same time) is stored once. */
  async ingest(sample: HostSample): Promise<{ stored: boolean }> {
    try {
      await this.prisma.serverSample.create({
        data: {
          at: new Date(sample.at),
          data: sample as unknown as Prisma.InputJsonValue,
        },
      });
      return { stored: true };
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return { stored: false };
      throw e;
    }
  }

  /** The latest sample, for the owner and viewers. */
  async status(userId: number, now = new Date()) {
    await this.access.requireViewer(userId);
    const [agent, latest] = await Promise.all([
      this.prisma.serverAgent.findUnique({ where: { id: 1 } }),
      this.prisma.serverSample.findFirst({ orderBy: { at: 'desc' } }),
    ]);
    return {
      agent: {
        configured: agent !== null,
        lastSeenAt: agent?.lastSeenAt ?? null,
      },
      sample: (latest?.data as unknown as HostSample) ?? null,
      stale: !latest || now.getTime() - latest.at.getTime() > AGENT_STALE_MS,
    };
  }
}
