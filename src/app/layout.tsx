import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import ShellWrapper from "@/components/ShellWrapper";

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
          themes={["dark", "light", "high-contrast"]}
          enableSystem={false}
          disableTransitionOnChange={false}
        >
          <ShellWrapper>{children}</ShellWrapper>
        </ThemeProvider>
      </body>
    </html>
  );
}
