'use client';
import { Button, Notice } from './ui';
import { useI18n } from '@/lib/i18n';
import { isStandalone } from '@/lib/mic';
import type { SpeechStatus } from '@/lib/voice/useSpeech';

/** Explains, for this phone, why the mic is not working and how to allow it. */
export function MicHelp({ status, os, onRetry }: { status: SpeechStatus; os: 'ios' | 'android' | 'other'; onRetry: () => void }) {
  const { t } = useI18n();
  if (status === 'unsupported') return <Notice tone="warn" icon="mic">{os === 'ios' && isStandalone() ? t('vo.iosPwa') : t('vo.unsupported')}</Notice>;
  if (status === 'denied') return (
    <div data-testid="mic-help">
      <Notice tone="warn" icon="mic">
        <span className="block font-semibold">{t('vo.denied')}</span>
        <span className="mt-1 block whitespace-pre-line">{os === 'ios' ? t('vo.stepsIos') : os === 'android' ? t('vo.stepsAndroid') : t('vo.stepsOther')}</span>
      </Notice>
      <Button full variant="secondary" onClick={onRetry}>{t('vo.tryAgain')}</Button>
    </div>
  );
  if (status === 'siri') return <Notice tone="warn" icon="mic"><span className="whitespace-pre-line">{t('vo.siri')}</span></Notice>;
  if (status === 'insecure') return <Notice tone="warn" icon="mic">{t('vo.insecure')}</Notice>;
  if (status === 'nospeech') return <Notice>{t('vo.noSpeech')}</Notice>;
  if (status === 'error') return <Notice tone="warn">{t('vo.error')}</Notice>;
  return null;
}
