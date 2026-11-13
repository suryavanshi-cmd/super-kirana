'use client';
import { Button, Notice } from './ui';
import { useI18n } from '@/lib/i18n';
import { blockedBrowser, isStandalone } from '@/lib/mic';

type Status = 'checking' | 'idle' | 'asking' | 'listening' | 'unsupported' | 'denied' | 'siri' | 'insecure' | 'tapAgain' | 'nospeech' | 'busy' | 'lang' | 'error';

/** Explains, for this phone and browser, why the mic is not working and exactly what to change. */
export function MicHelp({ status, os, onRetry }: { status: Status; os: 'ios' | 'android' | 'other'; onRetry: () => void }) {
  const { t } = useI18n();
  const blocked = blockedBrowser();
  const steps = os === 'ios' ? t('vo.stepsIos') : os === 'android' ? t('vo.stepsAndroid') : t('vo.stepsOther');
  let body: React.ReactNode = null;
  if (blocked === 'inapp' && status !== 'listening') body = <Notice tone="warn" icon="mic">{t('vo.inapp')}</Notice>;
  else if (status === 'unsupported') body = <Notice tone="warn" icon="mic">{blocked === 'iosOther' ? t('vo.iosOther') : os === 'ios' && isStandalone() ? t('vo.iosPwa') : t('vo.unsupported')}</Notice>;
  else if (status === 'denied') body = (
    <div data-testid="mic-help">
      <Notice tone="warn" icon="mic">
        <span className="block font-semibold">{t('vo.denied')}</span>
        <span className="mt-1 block whitespace-pre-line">{steps}</span>
      </Notice>
      <Button full variant="secondary" onClick={onRetry}>{t('vo.tryAgain')}</Button>
    </div>
  );
  else if (status === 'siri') body = <Notice tone="warn" icon="mic"><span className="whitespace-pre-line">{t('vo.siri')}</span></Notice>;
  else if (status === 'insecure') body = <Notice tone="warn" icon="mic">{t('vo.insecure')}</Notice>;
  else if (status === 'nospeech') body = <Notice>{t('vo.noSpeech')}</Notice>;
  else if (status === 'busy') body = <Notice tone="warn" icon="mic">{t('vo.busy')}</Notice>;
  else if (status === 'lang') body = <Notice tone="warn" icon="mic">{t('vo.lang2')}</Notice>;
  else if (status === 'error') body = <Notice tone="warn">{t('vo.error')}</Notice>;
  return (
    <>
      {body}
      {os === 'ios' && (
        <details className="my-2 rounded-xl border border-line p-2 text-sm">
          <summary className="min-h-10 cursor-pointer font-semibold text-brand-700">{t('vo.helpTitle')}</summary>
          <p className="mt-1 whitespace-pre-line">{t('vo.checklistIos')}</p>
        </details>
      )}
    </>
  );
}
