import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Barzinho — boas histórias, boa companhia', description: 'Seu lugar para descobrir filmes, acompanhar séries e compartilhar histórias. Uma comunidade para quem vive cinema.', applicationName:'Barzinho' };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="pt-BR" suppressHydrationWarning><body>{children}</body></html>; }
