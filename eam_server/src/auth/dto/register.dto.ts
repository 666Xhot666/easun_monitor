import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'errors.emailInvalid' })
  email!: string;

  // 8 chars is a floor, not a strength guarantee — this is a single-tenant
  // home dashboard, not a system that needs a full password-strength
  // policy, so we keep validation simple rather than pulling in a zxcvbn
  // dependency for it.
  @IsString()
  @MinLength(8, { message: 'errors.passwordTooShort' })
  password!: string;

  /** A household invite: join that household instead of getting one's own. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  inviteCode?: string;
}
