import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "paudio",
  description: "Podcast Tracking and Transcription",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-50 min-h-screen flex">
        {children}
      </body>
    </html>
  )
}
