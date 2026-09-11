import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'UBE IBP Platform | One Platform, One Data, One Plan',
  description: 'AI-Driven Integrated Business Planning (IBP) Simulation Platform for UBE Chemicals (Asia) PCL',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body className="antialiased min-h-screen bg-slate-50 text-slate-900 selection:bg-blue-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
