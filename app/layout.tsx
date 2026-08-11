import type { ReactNode } from "react";

export const metadata = {
  title: "Production plane",
  // noindex is not paranoia: this renders production data behind a login, and
  // the deployment URL is usually guessable.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
