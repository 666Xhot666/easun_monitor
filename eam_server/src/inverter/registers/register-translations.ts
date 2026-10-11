/**
 * The Register map's texts in other languages than English. The English
 * stays in the map itself; each language has a JSON catalog keyed by
 * register name (and panel program), with the same shape as the English.
 */
import type { Language } from '../../i18n/languages';
import type { RegisterDefinition } from './register-map';
import type { PanelSetting } from './smg-ii.panel-settings';
import uk from './smg-ii.uk.json';

interface RegisterTexts {
  label: string;
  description?: string;
  risk?: string;
  options?: readonly string[];
  optionDescriptions?: readonly string[];
  bits?: Readonly<Record<string, string>>;
}

interface PanelTexts {
  title: string;
  description: string;
  options?: readonly string[];
  default: string;
}

interface Catalog {
  /** For registers seen on the device but not identified; {{address}} is filled in. */
  unidentified: { label: string; description: string };
  registers: Readonly<Record<string, RegisterTexts>>;
  panelSettings: Readonly<Record<string, PanelTexts>>;
}

const CATALOGS: Partial<Record<Language, Catalog>> = { uk };

function registerTexts(
  catalog: Catalog,
  r: RegisterDefinition,
): RegisterTexts | undefined {
  const texts = catalog.registers[r.name];
  if (texts || r.verified !== false) return texts;
  const address = String(r.address);
  return {
    label: catalog.unidentified.label.replace('{{address}}', address),
    description: catalog.unidentified.description,
  };
}

/** The registers with their texts in `language`; English ones where none. */
export function translateRegisters(
  registers: readonly RegisterDefinition[],
  language: Language,
): readonly RegisterDefinition[] {
  const catalog = CATALOGS[language];
  if (!catalog) return registers;
  return registers.map((r) => {
    const texts = registerTexts(catalog, r);
    if (!texts) return r;
    const bits = texts.bits
      ? Object.fromEntries(
          Object.entries(texts.bits).map(([bit, text]) => [Number(bit), text]),
        )
      : undefined;
    return {
      ...r,
      label: texts.label,
      ...(texts.description && { description: texts.description }),
      ...(texts.risk && { risk: texts.risk }),
      ...(texts.options && { options: texts.options }),
      ...(texts.optionDescriptions && {
        optionDescriptions: texts.optionDescriptions,
      }),
      ...(bits && { bits }),
    };
  });
}

/** The panel-only settings with their texts in `language`. */
export function translatePanelSettings(
  settings: readonly PanelSetting[],
  language: Language,
): readonly PanelSetting[] {
  const catalog = CATALOGS[language];
  if (!catalog) return settings;
  return settings.map((s) => {
    const texts = catalog.panelSettings[s.program];
    return texts ? { ...s, ...texts } : s;
  });
}
