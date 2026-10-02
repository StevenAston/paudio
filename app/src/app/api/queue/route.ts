import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const jobs = await prisma.jobQueue.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        episode: {
          include: { podcast: true }
        }
      }
    })
    return NextResponse.json(jobs)
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch queue" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const episodeIds = body.episodeIds
    const type = body.type || "DOWNLOAD_AND_TRANSCRIBE"
    
    if (!episodeIds || !Array.isArray(episodeIds)) {
      return NextResponse.json({ error: "episodeIds array is required" }, { status: 400 })
    }

    const jobs = []
    for (const episodeId of episodeIds) {
      const initialProgress = type === "TRANSCRIBE_ONLY" ? 50.0 : 0.0;

      // Upsert job to avoid duplicates
      const job = await prisma.jobQueue.upsert({
        where: { episodeId },
        update: {
          status: "PENDING",
          progress: initialProgress,
          type,
        },
        create: {
          episodeId,
          type,
          status: "PENDING",
          progress: initialProgress,
        },
      })
      
      const updateData: any = {}
      if (type !== "TRANSCRIBE_ONLY") updateData.downloadStatus = "PENDING"
      if (type !== "DOWNLOAD_ONLY") updateData.transcribeStatus = "PENDING"
      
      await prisma.episode.update({
        where: { id: episodeId },
        data: updateData
      })
      jobs.push(job)
    }

    return NextResponse.json(jobs)
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to enqueue jobs" }, { status: 500 })
  }
}
