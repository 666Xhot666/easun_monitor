import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';
import { Button } from './index';

/** Copies `text` to the clipboard and says so for a moment. */
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? t('common.copied') : (label ?? t('common.copy'))}
    </Button>
  );
}
