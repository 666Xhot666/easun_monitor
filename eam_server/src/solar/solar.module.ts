import { Module } from '@nestjs/common';
import { PanelTypesController } from './panel-types.controller';

@Module({
  controllers: [PanelTypesController],
})
export class SolarModule {}
