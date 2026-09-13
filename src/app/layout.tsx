import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Spendly — See your financial future before you spend.',
  description: 'Compare financial futures, find your earliest safe purchase date, and buy with a little more confidence.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
