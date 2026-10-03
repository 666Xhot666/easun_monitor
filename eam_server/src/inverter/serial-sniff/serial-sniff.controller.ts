import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { IsNotEmpty, IsString } from 'class-validator';
import { SerialSniffer } from './serial-sniffer';

class StartSniffDto {
  @IsString()
  @IsNotEmpty()
  path!: string;
}

class FrameNoteDto {
  @IsString()
  note!: string;
}

/**
 * Dev-only serial sniff panel API. Exists only when NODE_ENV is not
 * production AND DEV_SERIAL_SNIFF=true (otherwise 404), and only for
 * signed-in users.
 */
@Controller('api/dev/serial')
@UseGuards(AuthGuard('jwt'))
export class SerialSniffController {
  constructor(
    private readonly sniffer: SerialSniffer,
    private readonly config: ConfigService,
  ) {}

  /** Status, the configured port path, and frames after `since`. */
  @Get()
  read(@Query('since') since = '0') {
    this.assertEnabled();
    return {
      ...this.sniffer.status(),
      defaultPath: this.config.get<string>('SERIAL_PORT') ?? null,
      frames: this.sniffer.frames(Number(since) || 0),
    };
  }

  @Post('start')
  async start(@Body() dto: StartSniffDto) {
    this.assertEnabled();
    await this.sniffer.start(dto.path).catch(() => {});
    return this.sniffer.status();
  }

  @Post('stop')
  async stop() {
    this.assertEnabled();
    await this.sniffer.stop();
    return this.sniffer.status();
  }

  @Post('frames/:seq/note')
  @HttpCode(HttpStatus.NO_CONTENT)
  note(@Param('seq', ParseIntPipe) seq: number, @Body() dto: FrameNoteDto) {
    this.assertEnabled();
    if (!this.sniffer.note(seq, dto.note)) {
      throw new NotFoundException('That frame is no longer in the capture buffer');
    }
  }

  private assertEnabled(): void {
    if (
      this.config.get<string>('NODE_ENV') === 'production' ||
      this.config.get<string>('DEV_SERIAL_SNIFF') !== 'true'
    ) {
      throw new NotFoundException();
    }
  }
}
