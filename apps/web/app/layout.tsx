import type { Metadata } from "next";
import "./globals.css";
import { DM_Sans } from "next/font/google";
import localFont from "next/font/local";
import { cn } from "@/lib/utils";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const eightiesComeback = localFont({
  src: "./fonts/EightiesComebackVAR-Regular.ttf",
  variable: "--font-display",
  weight: "300 900",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:59058"
  ),
  title: "Zdress — virtual try-on where you actually shop",
  description:
    "A browser extension that puts a try-on button on every product across sixteen fashion retailers and Pinterest. Upload your photo once; the card's photo becomes you wearing it.",
  icons: { icon: "/brand/zdress-mark.png" },
  openGraph: {
    images: ["/brand/zdress-journey.webp"],
    title: "Zdress — virtual try-on where you actually shop",
    description:
      "Try garments in the shopping grid, combine a fit across stores, and save every look with its source links.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      className={cn("dark", dmSans.variable, eightiesComeback.variable)}
      lang="en"
    >
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
