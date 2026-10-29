import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans_Hebrew, Secular_One } from 'next/font/google';
import './globals.css';
import { RouteShell } from '@/components/route-shell';
import { getConfig } from '@/lib/store';

// Interface text, page titles (used sparingly), and file / reference numbers.
const sans = IBM_Plex_Sans_Hebrew({ subsets: ['hebrew', 'latin'], weight: ['400', '500', '600', '700'], variable: '--nf-sans', display: 'swap' });
const display = Secular_One({ subsets: ['hebrew', 'latin'], weight: '400', variable: '--nf-display', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--nf-mono', display: 'swap' });

// Rendered per request: the title comes from the live config in the database,
// and the build (e.g. inside Docker) must not need a database connection.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const businessName = await getConfig()
    .then((config) => config.businessName)
    .catch(() => '');
  return {
    title: businessName || 'CRM_YE',
    description: 'ניהול תיקי לקוחות, מסמכים ותשלומים עבור מלווה בהגשות למשרדי ממשלה.',
  };
}

// Applies the saved theme before paint to avoid a light-mode flash.
const themeInit = `(function(){try{var t=localStorage.getItem('crmye-theme');if(t==='dark'){document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl" className={`${sans.variable} ${display.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className={sans.className} dir="rtl">
        <RouteShell>{children}</RouteShell>
      </body>
    </html>
  );
}
