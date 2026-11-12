import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { authMode } from "@/lib/config";
import { Toaster } from "./components/Toaster";
import { dark } from "@clerk/ui/themes";
import "./globals.css";

export const metadata: Metadata = {
  title: "Screw Drivers — server panel",
  description: "Manage several Screw Drivers dedicated servers from one place",
};

/** Site-wide credit; it sits outside ClerkProvider so signed-out pages show it too. */
function Footer() {
  return (
    <footer className="site-footer">
      Powered by{" "}
      <a href="https://krakenhosting.net/" target="_blank" rel="noopener noreferrer">
        Krakenhosting
      </a>
    </footer>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Clerk Core 3 requires ClerkProvider inside <body>, not around <html>. */}
        {authMode === "clerk" ? (
          <ClerkProvider appearance={{ theme: dark }}>
            {children}
            <Footer />
            <Toaster />
          </ClerkProvider>
        ) : (
          <>
            {children}
            <Footer />
            <Toaster />
          </>
        )}
      </body>
    </html>
  );
}
