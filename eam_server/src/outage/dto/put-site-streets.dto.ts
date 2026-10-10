import { IsIn, IsObject } from 'class-validator';

/** PUT /api/outage/reader/streets body. */
export class PutSiteStreetsDto {
  @IsIn(['dnem'])
  site!: 'dnem';

  /** { city: [street, ...] }; checked further by the service. */
  @IsObject()
  streets!: Record<string, string[]>;
}
