'use client';
// Microphone permission for speech entry on Android (Chrome) and iPhone/iPad (Safari).
//
// Browsers only show the system "allow microphone" prompt in response to a tap, and a web page can
// never open the phone's settings app itself. So: we ask through getUserMedia on the tap (this is
// what shows the iOS / Android prompt), release the microphone at once (iOS speech recognition will
// not start while another recording is open), and when the answer is "no" we show the exact steps
// for that phone.

export type Platform = 'ios' | 'android' | 'other';
export type MicState = 'granted' | 'denied' | 'prompt' | 'unknown';

export function platform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

/** Installed to the home screen (opened without the browser bar). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/** Current permission without prompting, where the browser can tell (not every iOS version can). */
export async function micState(): Promise<MicState> {
  try {
    const p = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
    if (p && (p.state === 'granted' || p.state === 'denied' || p.state === 'prompt')) return p.state;
  } catch { /* not supported */ }
  return 'unknown';
}

/**
 * Asks for the microphone (shows the system prompt the first time). Must be called from a tap.
 * Returns 'granted', 'denied', or 'unavailable' when the device has no microphone / no support.
 */
export async function requestMic(): Promise<'granted' | 'denied' | 'unavailable' | 'insecure'> {
  if (typeof window !== 'undefined' && !window.isSecureContext) return 'insecure';
  if (!navigator.mediaDevices?.getUserMedia) return 'unavailable';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());      // release at once; speech recognition opens its own
    return 'granted';
  } catch (e) {
    const name = e instanceof DOMException ? e.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'unavailable';
    return 'denied';
  }
}

/**
 * Browsers that cannot do speech typing on iPhone: links opened inside WhatsApp, Instagram, Facebook
 * etc. (in-app browsers), and Chrome / Firefox / Edge on iPhone. Safari works.
 */
export function blockedBrowser(): 'inapp' | 'iosOther' | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/FBAN|FBAV|Instagram|WhatsApp|Line\/|Snapchat|; wv\)|GSA\//i.test(ua)) return 'inapp';
  if (platform() === 'ios' && /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)) return 'iosOther';
  return null;
}
