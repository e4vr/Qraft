import type { Metadata, Viewport } from 'next';
import { PresentationProvider } from '@/features/presentation/presentation-context';
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

const themeBootstrap = `(()=>{try{const t=localStorage.getItem('qraft-theme-active')||'system';const d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'}catch{}})()`;

const presentationBootstrap = `(()=>{try{const standalone=matchMedia('(display-mode:standalone)').matches||navigator.standalone===true;const handheld=matchMedia('(max-width:560px),(max-width:767px) and (hover:none),(max-width:767px) and (pointer:coarse)').matches||(standalone&&matchMedia('(max-width:899px)').matches);const desktop=matchMedia('(min-width:1180px) and (hover:hover) and (pointer:fine)').matches;document.documentElement.dataset.presentation=handheld?'handheld':desktop?'desktop':'tablet';document.documentElement.dataset.standalone=standalone?'true':'false'}catch{}})()`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }} /><script dangerouslySetInnerHTML={{ __html: presentationBootstrap }} /></head><body><PresentationProvider><div className="q-viewport">{children}</div></PresentationProvider></body></html>;
}
