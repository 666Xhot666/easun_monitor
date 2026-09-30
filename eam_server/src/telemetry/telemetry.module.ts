import { Module } from '@nestjs/common';
import { TelemetryStore } from './telemetry.store';

@Module({
  providers: [TelemetryStore],
  exports: [TelemetryStore],
})
export class TelemetryModule {}
