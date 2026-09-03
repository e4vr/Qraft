import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MedGuard Collaborative QBank',
  description: 'A secure collaborative platform for building, reviewing, and studying multiple medical QBanks.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon-192.png',
    apple: '/icon-192.png',
  },
  openGraph: {
    title: 'MedGuard Collaborative QBank',
    description: 'Build. Review. Learn together.',
    images: ['/og.png'],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MedGuard Collaborative QBank',
    description: 'Build. Review. Learn together.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
