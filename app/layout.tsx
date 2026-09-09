import type { Metadata, Viewport } from 'next';
import './globals.css';
import './admin.css';
import './billing-admin.css';

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: [{media:'(prefers-color-scheme: light)',color:'#ffffff'},{media:'(prefers-color-scheme: dark)',color:'#0d1b2a'}] };

export const metadata: Metadata = {
  title: 'Qraft Collaborative QBank',
  description: 'A secure collaborative platform for building, reviewing, and studying multiple medical QBanks.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Qraft' },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png?v=3', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png?v=3',
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
