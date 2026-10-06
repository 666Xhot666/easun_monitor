import { IsEnum } from 'class-validator';
import { HouseholdRole } from '../../generated/prisma/enums';

/** A role in a household: ADMIN or READER. */
export class HouseholdRoleDto {
  @IsEnum(HouseholdRole, { message: 'role must be ADMIN or READER' })
  role!: HouseholdRole;
}
