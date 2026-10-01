import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import fs from "fs/promises"

// External API for tubeseek: queue a YouTube video through the normal download → Whisper pipeline,
// then poll GET until the transcript is ready. Episodes are keyed by video id (same guid as YouTube channels use).

export const dynamic = "force-dynamic"

const VIDEO_ID = /^[\w-]{11}$/
const TUBESEEK_FEED = "tubeseek://external"

export async function POST(request: Request) {
  const { youtubeId } = await request.json().catch(() => ({}))
  if (!VIDEO_ID.test(youtubeId ?? "")) return NextResponse.json({ error: "valid youtubeId is required" }, { status: 400 })

  const existing = await prisma.episode.findUnique({ where: { guid: youtubeId } })
  if (existing?.transcribeStatus === "TRANSCRIBED" || existing?.transcribeStatus === "PENDING" || existing?.transcribeStatus === "TRANSCRIBING") {
    return NextResponse.json({ status: existing.transcribeStatus })
  }

  const podcast = await prisma.podcast.upsert({
    where: { feedUrl: TUBESEEK_FEED },
    update: {},
    create: { feedUrl: TUBESEEK_FEED, title: "tubeseek", sourceType: "YOUTUBE" },
  })
  const audioUrl = `https://www.youtube.com/watch?v=${youtubeId}`
  const episode = existing ?? await prisma.episode.create({
    data: { guid: youtubeId, title: youtubeId, audioUrl, youtubeVideoId: youtubeId, podcastId: podcast.id },
  })

  await prisma.jobQueue.upsert({
    where: { episodeId: episode.id },
    update: { status: "PENDING", progress: 0, type: "DOWNLOAD_AND_TRANSCRIBE", errorMessage: null },
    create: { episodeId: episode.id, status: "PENDING", progress: 0, type: "DOWNLOAD_AND_TRANSCRIBE" },
  })
  await prisma.episode.update({ where: { id: episode.id }, data: { downloadStatus: "PENDING", transcribeStatus: "PENDING" } })

  // Over HTTP rather than importing: the worker route holds the in-process worker counts, so it must be the same module instance
  fetch(new URL("/api/worker", request.url), { method: "POST" }).catch(() => {})
  return NextResponse.json({ status: "PENDING" }, { status: 202 })
}

export async function GET(request: Request) {
  const youtubeId = new URL(request.url).searchParams.get("youtubeId") ?? ""
  if (!VIDEO_ID.test(youtubeId)) return NextResponse.json({ error: "valid youtubeId is required" }, { status: 400 })

  const episode = await prisma.episode.findUnique({ where: { guid: youtubeId }, include: { jobQueue: true } })
  if (!episode) return NextResponse.json({ status: "UNKNOWN" }, { status: 404 })
  if (episode.transcribeStatus !== "TRANSCRIBED" || !episode.localTranscriptPath) {
    return NextResponse.json({ status: episode.transcribeStatus, error: episode.jobQueue?.errorMessage ?? undefined })
  }

  // Engines differ: faster-whisper/whisperx give segments {start,end}, insanely-fast-whisper gives chunks {timestamp:[s,e]}
  type Seg = { start?: number; end?: number; timestamp?: [number, number | null]; text?: string }
  const data = JSON.parse(await fs.readFile(episode.localTranscriptPath, "utf8"))
  const segments = (data.segments ?? data.chunks ?? []).map((s: Seg) => {
    const start = s.start ?? s.timestamp?.[0] ?? 0
    return { start, end: s.end ?? s.timestamp?.[1] ?? start, text: (s.text ?? "").trim() }
  })
  return NextResponse.json({ status: "TRANSCRIBED", segments })
}
