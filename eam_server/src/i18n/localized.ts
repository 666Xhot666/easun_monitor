import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { languageOr, type Language } from './languages';
import { translate } from './translate';

type Values = Record<string, string | number>;

/** A message key under "errors" in the catalogs, as DTOs give it. */
const KEY = /^errors\.[A-Za-z0-9.]+$/;

/**
 * An error body worded in each request's language by LocalizedErrorFilter:
 * `throw new BadRequestException(localized('rangeTooLong'))`. The English
 * message is kept for callers that read the body as it is.
 */
export function localized(key: string, values?: Values) {
  const full = `errors.${key}`;
  return { message: translate('en', full, values), key: full, values };
}

/** The language a request asks for in its Accept-Language header (en if neither). */
export function requestLanguage(header: string | undefined): Language {
  const first = header?.split(',')[0]?.trim().split(/[-;]/)[0];
  return languageOr(first?.toLowerCase());
}

/** Words an error message, or a key from a DTO, in `language`; other text as it is. */
const word = (message: unknown, language: Language) =>
  typeof message === 'string' && KEY.test(message)
    ? translate(language, message)
    : message;

/**
 * Error bodies in the request's language: errors thrown with `localized`
 * and DTO messages given as keys. Anything else passes as Nest sends it.
 */
@Catch(HttpException)
export class LocalizedErrorFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const language = requestLanguage(
      http.getRequest<Request>().headers['accept-language'],
    );
    const status = exception.getStatus();
    const body = exception.getResponse();
    http
      .getResponse<Response>()
      .status(status)
      .json(wordBody(body, status, language));
  }
}

function wordBody(body: string | object, status: number, language: Language) {
  if (typeof body === 'string') return { statusCode: status, message: body };
  const fields = body as Record<string, unknown>;
  if (typeof fields.key === 'string') {
    return {
      statusCode: status,
      message: translate(language, fields.key, fields.values as Values),
    };
  }
  const { message } = fields;
  return {
    ...fields,
    message: Array.isArray(message)
      ? message.map((m) => word(m, language))
      : word(message, language),
  };
}
