import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'BookBarber — Premium Barbershop Booking',
    template: '%s | BookBarber',
  },
  description:
    'Book your next haircut online. Real-time availability, instant confirmation, and easy rescheduling.',
  keywords: ['barbershop', 'booking', 'haircut', 'barber', 'appointment'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
