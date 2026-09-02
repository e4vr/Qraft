import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MedGuard - SMLE QBank',
  description: 'A fast, focused SMLE question bank built for daily study.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon-192.png',
    apple: '/icon-192.png',
  },
  openGraph: {
    title: 'MedGuard - SMLE QBank',
    description: 'Study with focus. Improve with every question.',
    images: ['/og.png'],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MedGuard - SMLE QBank',
    description: 'Study with focus. Improve with every question.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
