import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'A valid email address is required' })
  email!: string;

  // 8 chars is a floor, not a strength guarantee — this is a single-tenant
  // home dashboard, not a system that needs a full password-strength
  // policy, so we keep validation simple rather than pulling in a zxcvbn
  // dependency for it.
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password!: string;
}
