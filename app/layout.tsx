import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Maze Race — AI Agent Battle',
  description: '4 AI agents race through a maze to reach the center first',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
