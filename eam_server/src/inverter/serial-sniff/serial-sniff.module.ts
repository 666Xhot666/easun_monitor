import { Module } from '@nestjs/common';
import { openSerialTap } from './serial-port-tap';
import { SerialSniffController } from './serial-sniff.controller';
import { SerialSniffer, type SerialTapFactory } from './serial-sniffer';

/** Opens serial ports for the sniffer; replaced by a fake in tests. */
export const SERIAL_TAP_FACTORY = Symbol('SERIAL_TAP_FACTORY');

@Module({
  controllers: [SerialSniffController],
  providers: [
    { provide: SERIAL_TAP_FACTORY, useValue: openSerialTap satisfies SerialTapFactory },
    {
      provide: SerialSniffer,
      inject: [SERIAL_TAP_FACTORY],
      useFactory: (openTap: SerialTapFactory) => new SerialSniffer(openTap),
    },
  ],
})
export class SerialSniffModule {}
