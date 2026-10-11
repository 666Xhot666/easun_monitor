import { IsString, MinLength } from 'class-validator';

/** POST /api/auth/password body. */
export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: 'errors.passwordTooShort' })
  newPassword!: string;
}
