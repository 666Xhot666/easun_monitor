import { IsString, Matches } from 'class-validator';
import {
  HOST_ADDRESS_MESSAGE,
  HOST_ADDRESS_PATTERN,
} from '../../common/validators/host-address';

export class PairTestDto {
  @IsString()
  @Matches(HOST_ADDRESS_PATTERN, { message: HOST_ADDRESS_MESSAGE })
  ipAddress!: string;
}
