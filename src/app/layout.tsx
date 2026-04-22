import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import GlobalShell from "@/components/GlobalShell";

export const metadata: Metadata = {
  title: "Threads by Cloud Weaver — Weaves your cloud data",
  description: "Threads by Cloud Weaver weaves your cloud data. Connect, transform, and deliver data between any source and destination.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange={false}
        >
          <div className="pl-[220px] pb-[44px]">
            {children}
          </div>
          <GlobalShell />
        </ThemeProvider>
      </body>
    </html>
  );
}
