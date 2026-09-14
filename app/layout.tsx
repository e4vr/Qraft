import type { Metadata, Viewport } from 'next';
import './globals.css';
import './admin.css';
import './billing-admin.css';

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: [{media:'(prefers-color-scheme: light)',color:'#f4f7fb'},{media:'(prefers-color-scheme: dark)',color:'#07111d'}] };

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

// iOS can ignore the viewport's zoom limits, especially in standalone mode.
// Keep the browser experience accessible while making the installed PWA feel
// like a native app with a fixed viewport.
const pwaZoomGuard = `(()=>{try{const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);if(!standalone||!ios)return;const lockViewport=()=>{const meta=document.querySelector('meta[name="viewport"]');if(meta)meta.setAttribute('content','width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover')};lockViewport();document.addEventListener('DOMContentLoaded',lockViewport,{once:true});const prevent=(event)=>{if(event.cancelable)event.preventDefault()};for(const type of ['gesturestart','gesturechange','gestureend'])document.addEventListener(type,prevent,{passive:false});document.addEventListener('touchmove',(event)=>{if(event.touches.length>1)prevent(event)},{passive:false})}catch{}})()`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }} /><script dangerouslySetInnerHTML={{ __html: pwaZoomGuard }} /></head><body><div className="q-viewport">{children}</div></body></html>;
}
