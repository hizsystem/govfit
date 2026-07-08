import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 디자인 지정 폰트 — Inter (라틴), 한글은 시스템 한글 폰트로 폴백
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Brand Rise — 스몰브랜드 브랜딩·마케팅 컨설팅",
  description:
    "좋은 기업이, 더 좋은 기회를 만나는 곳. 18년간 쌓은 노하우로 스몰브랜드의 브랜딩과 마케팅을 시작부터 끝까지 함께합니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
