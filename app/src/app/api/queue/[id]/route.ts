import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { action } = await request.json()
    const { id: jobId } = await params

    const job = await prisma.jobQueue.findUnique({ where: { id: jobId } })
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 })

    if (action === "pause") {
      if (job.status === "PENDING" || job.status === "IN_PROGRESS") {
        await prisma.jobQueue.update({
          where: { id: jobId },
          data: { status: "PAUSED" }
        })
      }
    } else if (action === "resume") {
      if (job.status === "PAUSED" || job.status === "IN_PROGRESS" || job.status === "ERROR") {
        await prisma.jobQueue.update({
          where: { id: jobId },
          data: { status: "PENDING", errorMessage: null }
        })
      }
    } else if (action === "delete") {
      await prisma.jobQueue.delete({ where: { id: jobId } })
      
      // Reset episode statuses if deleted
      await prisma.episode.update({
        where: { id: job.episodeId },
        data: {
          downloadStatus: "UNPROCESSED",
          transcribeStatus: "UNPROCESSED",
        }
      })
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to update job" }, { status: 500 })
  }
}
