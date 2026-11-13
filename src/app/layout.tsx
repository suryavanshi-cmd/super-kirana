import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import { THEME_BOOT } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'सुपर किराणा, निफाड',
  description: 'सुपर किराणा, निफाड — बिल आणि उधारी खाते / Super Kirana, Niphad — billing and customer khata',
  applicationName: 'सुपर किराणा',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'सुपर किराणा', statusBarStyle: 'default' },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#b34d08' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="mr" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} /></head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
