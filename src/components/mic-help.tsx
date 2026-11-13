'use client';
import { Button, Notice } from './ui';
import { useI18n } from '@/lib/i18n';
import type { Key } from '@/lib/dictionary';
import { blockedBrowser, isStandalone } from '@/lib/mic';
import type { SpeechStatus } from '@/lib/voice/useSpeech';

type Status = SpeechStatus;

/** The one-line state under a mic button, the same on every screen. */
export function speechLabel(t: (k: Key, v?: Record<string, string | number>) => string, s: { status: SpeechStatus; interim: string; mode: 'native' | 'cloud' }, idle: string): string {
  if (s.status === 'listening') return s.interim || (s.mode === 'cloud' ? t('vo.recording') : t('vo.listening'));
  if (s.status === 'thinking') return t('vo.thinking');
  if (s.status === 'asking') return t('vo.asking');
  if (s.status === 'tapAgain') return t('vo.tapAgain');
  return idle;
}

/** Explains, for this phone and browser, why the mic is not working and exactly what to change. */
export function MicHelp({ status, os, onRetry, cause }: { status: Status; os: 'ios' | 'android' | 'other'; onRetry: () => void; cause?: string }) {
  const { t } = useI18n();
  const blocked = blockedBrowser();
  const steps = os === 'ios' ? t('vo.stepsIos') : os === 'android' ? t('vo.stepsAndroid') : t('vo.stepsOther');
  let body: React.ReactNode = null;
  // The backup recogniser works in most of these browsers, so only explain when nothing works.
  if (blocked === 'inapp' && (status === 'unsupported' || status === 'denied')) body = <Notice tone="warn" icon="mic">{t('vo.inapp')}</Notice>;
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
  else if (status === 'quota') body = <Notice tone="warn">{t('err.AI_BUSY')}</Notice>;
  else if (status === 'demo') body = <Notice tone="warn">{t('err.DEMO_LIMIT')}</Notice>;
  else if (status === 'error') body = <Notice tone="warn">{t('vo.error')}</Notice>;
  const showCause = !!cause && ['error', 'quota', 'busy', 'lang', 'denied', 'unsupported', 'siri'].includes(status);
  return (
    <>
      {body}
      {showCause && <p data-testid="mic-cause" className="-mt-1 mb-2 break-words text-xs text-muted">{t('err.reason')}: {cause}</p>}
      {os === 'ios' && (
        <details className="my-2 rounded-xl border border-line bg-white p-2 text-sm">
          <summary className="min-h-10 cursor-pointer font-semibold text-brand-700">{t('vo.helpTitle')}</summary>
          <p className="mt-1 whitespace-pre-line">{t('vo.checklistIos')}</p>
        </details>
      )}
    </>
  );
}
