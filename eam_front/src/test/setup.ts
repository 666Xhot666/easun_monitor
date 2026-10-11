import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import i18n from '../i18n';

// Tests read the English texts, whatever the machine's language.
beforeEach(() => {
  void i18n.changeLanguage('en');
});

afterEach(() => {
  cleanup();
});
