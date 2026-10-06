import { Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/** No 0/O, 1/I/L: easy to read out and type. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const VALID_FOR_MS = 10 * 60_000;

const normalize = (code: string) =>
  code.toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashCode = (code: string) =>
  createHash('sha256').update(normalize(code)).digest('hex');

/** Which Telegram chat belongs to which user, and the codes that link them. */
@Injectable()
export class TelegramLinksService {
  constructor(private readonly prisma: PrismaService) {}

  /** A new one-time code for the user; any earlier code stops working. */
  async createCode(userId: number) {
    const code = Array.from(
      { length: CODE_LENGTH },
      () => ALPHABET[randomInt(ALPHABET.length)],
    ).join('');
    const expiresAt = new Date(Date.now() + VALID_FOR_MS);
    await this.prisma.$transaction([
      this.prisma.telegramLinkCode.deleteMany({ where: { userId } }),
      this.prisma.telegramLinkCode.create({
        data: { userId, codeHash: hashCode(code), expiresAt },
      }),
    ]);
    return { code, expiresAt };
  }

  async isLinked(userId: number): Promise<boolean> {
    return (await this.prisma.telegramLink.count({ where: { userId } })) > 0;
  }

  async unlinkUser(userId: number): Promise<void> {
    await this.prisma.telegramLink.deleteMany({ where: { userId } });
  }

  async unlinkChat(chatId: string): Promise<void> {
    await this.prisma.telegramLink.deleteMany({ where: { chatId } });
  }

  /**
   * Links the chat to the code's user and uses up the code; null when the
   * code is unknown or expired. A chat or user linked before is relinked.
   */
  async linkChat(
    code: string,
    chatId: string,
  ): Promise<{ userId: number; email: string } | null> {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.telegramLinkCode.findUnique({
        where: { codeHash: hashCode(code) },
        include: { user: { select: { email: true } } },
      });
      if (!found || found.expiresAt <= new Date()) return null;
      await tx.telegramLinkCode.delete({ where: { id: found.id } });
      await tx.telegramLink.deleteMany({
        where: { OR: [{ chatId }, { userId: found.userId }] },
      });
      await tx.telegramLink.create({ data: { chatId, userId: found.userId } });
      return { userId: found.userId, email: found.user.email };
    });
  }

  /** The user a chat is linked to, or null. */
  async userForChat(chatId: string): Promise<number | null> {
    const link = await this.prisma.telegramLink.findUnique({
      where: { chatId },
      select: { userId: true },
    });
    return link?.userId ?? null;
  }
}
