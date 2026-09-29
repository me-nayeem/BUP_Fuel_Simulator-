import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/AppShell';
import { LiveDataProvider } from '@/components/providers/LiveDataProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Fuel Ops Command Center',
  description: 'Fuel supply intelligence and resilience platform for the BUP Fuel Supply Simulator',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="antialiased">
      <body>
        <LiveDataProvider>
          <AppShell>{children}</AppShell>
        </LiveDataProvider>
      </body>
    </html>
  );
}
