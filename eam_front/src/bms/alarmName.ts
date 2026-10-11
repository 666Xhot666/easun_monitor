import i18n from '../i18n';

/** A BMS alarm's name in the current language; the BMS reports it in English. */
export const alarmName = (alarm: string): string => i18n.t(`bmsAlarms.${alarm}`, { defaultValue: alarm });
