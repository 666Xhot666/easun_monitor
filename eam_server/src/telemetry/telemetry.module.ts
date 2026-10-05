import { Module } from '@nestjs/common';
import { SettingsHistory } from './settings-history';
import { TelemetryStore } from './telemetry.store';

@Module({
  providers: [TelemetryStore, SettingsHistory],
  exports: [TelemetryStore, SettingsHistory],
})
export class TelemetryModule {}
