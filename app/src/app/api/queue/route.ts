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
    const { episodeIds } = await request.json()
    if (!episodeIds || !Array.isArray(episodeIds)) {
      return NextResponse.json({ error: "episodeIds array is required" }, { status: 400 })
    }

    const jobs = []
    for (const episodeId of episodeIds) {
      // Upsert job to avoid duplicates
      const job = await prisma.jobQueue.upsert({
        where: { episodeId },
        update: {
          status: "PENDING",
          progress: 0,
        },
        create: {
          episodeId,
          type: "DOWNLOAD_AND_TRANSCRIBE",
          status: "PENDING",
        },
      })
      
      await prisma.episode.update({
        where: { id: episodeId },
        data: {
          downloadStatus: "PENDING",
          transcribeStatus: "PENDING",
        }
      })
      jobs.push(job)
    }

    return NextResponse.json(jobs)
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to enqueue jobs" }, { status: 500 })
  }
}
