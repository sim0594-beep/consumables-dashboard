import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "가치실천팀 소모품 운영현황 대시보드",
  description: "가치실천팀 미화소모품·푸드소모품 월별 수불관리 대시보드"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
