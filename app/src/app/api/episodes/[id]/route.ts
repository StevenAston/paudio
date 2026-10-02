import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolvedParams = await params
    const { youtubeAudioFormatId, youtubeSubtitleFormatId } = await request.json()
    
    const episode = await prisma.episode.update({
      where: { id: resolvedParams.id },
      data: {
        youtubeAudioFormatId,
        youtubeSubtitleFormatId
      }
    })
    
    return NextResponse.json(episode)
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to update episode" }, { status: 500 })
  }
}
