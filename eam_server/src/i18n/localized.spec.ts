import { localized, requestLanguage } from './localized';

describe('localized errors', () => {
  it('keeps the English message with the key and values', () => {
    expect(localized('rangeTooLong', { days: 31 })).toEqual({
      message: 'A range can cover at most 31 days',
      key: 'errors.rangeTooLong',
      values: { days: 31 },
    });
  });

  it("reads the request's language from Accept-Language", () => {
    expect(requestLanguage('uk')).toBe('uk');
    expect(requestLanguage('uk-UA,uk;q=0.9,en;q=0.8')).toBe('uk');
    expect(requestLanguage('ru-RU,ru;q=0.9')).toBe('en');
    expect(requestLanguage(undefined)).toBe('en');
  });
});
