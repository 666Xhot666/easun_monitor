import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'errors.emailInvalid' })
  email!: string;

  @IsString()
  password!: string;
}
