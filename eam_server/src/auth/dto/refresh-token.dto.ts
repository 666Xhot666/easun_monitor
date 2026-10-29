import { IsOptional, IsString, MaxLength } from 'class-validator';

/** The mobile app's refresh token, sent in the body instead of a cookie. */
export class RefreshTokenDto {
  /** As returned by login, register or the previous refresh. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  refreshToken?: string;
}
