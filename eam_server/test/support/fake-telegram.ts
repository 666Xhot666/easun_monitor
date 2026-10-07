import type {
  BotCommand,
  MessageOptions,
  TelegramClient,
} from '../../src/telegram/telegram-client';

export interface SentMessage {
  chatId: string;
  text: string;
  options?: MessageOptions;
  /** Set when the bot edited an earlier message instead of sending. */
  editedMessageId?: number;
}

/** Records what the bot sends instead of calling Telegram. */
export class FakeTelegram implements TelegramClient {
  sent: SentMessage[] = [];
  photos: { chatId: string; png: Buffer; caption?: string }[] = [];
  answered: string[] = [];
  commands: BotCommand[] = [];

  getUpdates() {
    return Promise.resolve([]);
  }
  sendMessage(chatId: string, text: string, options?: MessageOptions) {
    this.sent.push({ chatId, text, options });
    return Promise.resolve();
  }
  editMessage(
    chatId: string,
    messageId: number,
    text: string,
    options?: MessageOptions,
  ) {
    this.sent.push({ chatId, text, options, editedMessageId: messageId });
    return Promise.resolve();
  }
  answerCallback(callbackId: string) {
    this.answered.push(callbackId);
    return Promise.resolve();
  }
  sendPhoto(chatId: string, png: Buffer, caption?: string) {
    this.photos.push({ chatId, png, caption });
    return Promise.resolve();
  }
  setCommands(commands: BotCommand[]) {
    this.commands = commands;
    return Promise.resolve();
  }
}
