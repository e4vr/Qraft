import type { Metadata, Viewport } from 'next';
import './globals.css';

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: [{media:'(prefers-color-scheme: light)',color:'#f4f7fb'},{media:'(prefers-color-scheme: dark)',color:'#111827'}] };

export const metadata: Metadata = {
  title: 'Qraft Collaborative QBank',
  description: 'A secure collaborative platform for building, reviewing, and studying multiple medical QBanks.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Qraft' },
  icons: {
    icon: '/icon-192.png',
    apple: '/icon-192.png',
  },
  openGraph: {
    title: 'Qraft Collaborative QBank',
    description: 'Build. Review. Learn together.',
    images: ['/icon-512.png'],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Qraft Collaborative QBank',
    description: 'Build. Review. Learn together.',
    images: ['/icon-512.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><div className="q-viewport">{children}</div></body></html>;
}
