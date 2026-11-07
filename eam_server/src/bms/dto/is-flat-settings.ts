import { registerDecorator, type ValidationOptions } from 'class-validator';
import { MAX_SETTINGS, SETTING_NAME } from '../constants';

/** True for a plain object of at most MAX_SETTINGS camelCase names, each a finite number or a boolean. */
export function isFlatSettings(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const entries = Object.entries(value);
  return (
    entries.length <= MAX_SETTINGS &&
    entries.every(
      ([name, v]) =>
        SETTING_NAME.test(name) &&
        (typeof v === 'boolean' ||
          (typeof v === 'number' && Number.isFinite(v))),
    )
  );
}

export function IsFlatSettings(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isFlatSettings',
      target: target.constructor,
      propertyName,
      options: {
        message: `$property must map up to ${MAX_SETTINGS} setting names to numbers or booleans`,
        ...options,
      },
      validator: { validate: isFlatSettings },
    });
}
