import '@/styles/globals.css';
import type { AppProps } from 'next/app';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <html lang="en">
      <body>
        <Component {...pageProps} />
      </body>
    </html>
  );
}