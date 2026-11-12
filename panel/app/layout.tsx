import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { authMode } from "@/lib/config";
import { Toaster } from "./components/Toaster";
import "./globals.css";

export const metadata: Metadata = {
  title: "Screw Drivers — server panel",
  description: "Manage several Screw Drivers dedicated servers from one place",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Clerk Core 3 requires ClerkProvider inside <body>, not around <html>. */}
        {authMode === "clerk" ? (
          <ClerkProvider>
            {children}
            <Toaster />
          </ClerkProvider>
        ) : (
          <>
            {children}
            <Toaster />
          </>
        )}
      </body>
    </html>
  );
}
