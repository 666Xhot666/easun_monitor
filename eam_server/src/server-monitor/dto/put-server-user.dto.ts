import { IsBoolean } from 'class-validator';

/** PUT /api/server/users/:userId body. */
export class PutServerUserDto {
  /** May look at the server page. */
  @IsBoolean()
  viewer!: boolean;
}
