import { Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SerialSniffController } from './serial-sniff.controller';
import { CaptureStore } from './capture-store';
import { SerialCapture } from './serial-capture';
import type { SerialTapFactory } from './serial-capture';
import { openSerialTap } from './serial-port-tap';

/** Opens serial ports for the capture; replaced by a fake in tests. */
export const SERIAL_TAP_FACTORY = Symbol('SERIAL_TAP_FACTORY');

@Module({
  controllers: [SerialSniffController],
  providers: [
    { provide: SERIAL_TAP_FACTORY, useValue: openSerialTap },
    {
      provide: CaptureStore,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new CaptureStore(config.get<string>('DEV_CAPTURE_DIR') ?? '.dev-captures'),
    },
    {
      provide: SerialCapture,
      inject: [SERIAL_TAP_FACTORY, CaptureStore],
      useFactory: (openTap: SerialTapFactory, store: CaptureStore) => new SerialCapture({ openTap, store }),
    },
  ],
})
export class SerialSniffModule implements OnModuleDestroy {
  constructor(private readonly capture: SerialCapture) {}

  /** Closes the ports and stops retrying when the server shuts down. */
  async onModuleDestroy(): Promise<void> {
    await this.capture.stop();
  }
}
