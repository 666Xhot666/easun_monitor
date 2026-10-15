import { IsIn } from 'class-validator';
import { LANGUAGES, type Language } from '../../i18n/languages';

/** PUT /api/auth/language body. */
export class SetLanguageDto {
  @IsIn(LANGUAGES)
  language!: Language;
}
