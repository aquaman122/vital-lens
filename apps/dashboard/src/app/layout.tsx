import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'vital-lens',
  description: 'Core Web Vitals + 에러 회귀 대시보드',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
