import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import fs from "fs"

export async function POST(request: Request) {
  try {
    const { episodeIds } = await request.json()
    if (!episodeIds || !Array.isArray(episodeIds)) {
      return NextResponse.json({ error: "episodeIds array is required" }, { status: 400 })
    }

    const episodes = await prisma.episode.findMany({
      where: { id: { in: episodeIds } }
    })

    for (const ep of episodes) {
      // Clean up files
      if (ep.localAudioPath && fs.existsSync(ep.localAudioPath)) {
        try { fs.unlinkSync(ep.localAudioPath) } catch (e) { console.error("Failed to delete audio:", e) }
        // Also try to delete .wav
        const wavPath = ep.localAudioPath.replace(/\.[^/.]+$/, ".wav")
        if (fs.existsSync(wavPath)) {
          try { fs.unlinkSync(wavPath) } catch (e) { console.error("Failed to delete wav:", e) }
        }
      }
      
      if (ep.localTranscriptPath && fs.existsSync(ep.localTranscriptPath)) {
        try { fs.unlinkSync(ep.localTranscriptPath) } catch (e) { console.error("Failed to delete transcript:", e) }
        // Also try to delete .md and .txt
        const mdPath = ep.localTranscriptPath.replace(".json", ".md")
        const txtPath = ep.localTranscriptPath.replace(".json", ".txt")
        if (fs.existsSync(mdPath)) {
          try { fs.unlinkSync(mdPath) } catch (e) { console.error("Failed to delete md transcript:", e) }
        }
        if (fs.existsSync(txtPath)) {
          try { fs.unlinkSync(txtPath) } catch (e) { console.error("Failed to delete txt transcript:", e) }
        }
      }

      // Delete from JobQueue
      await prisma.jobQueue.deleteMany({
        where: { episodeId: ep.id }
      })

      // Reset episode status
      await prisma.episode.update({
        where: { id: ep.id },
        data: {
          downloadStatus: "UNPROCESSED",
          transcribeStatus: "UNPROCESSED",
          localAudioPath: null,
          localTranscriptPath: null,
        }
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to clear episodes" }, { status: 500 })
  }
}
