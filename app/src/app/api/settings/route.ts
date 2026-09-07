import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    let settings = await prisma.settings.findUnique({
      where: { id: "global" }
    })
    
    // Create default settings if it doesn't exist
    if (!settings) {
      settings = await prisma.settings.create({
        data: {
          id: "global",
          namingTemplate: "{podcast_title} - {episode_number}",
          transcriptionEngine: "insanely-fast-whisper"
        }
      })
    }
    
    return NextResponse.json(settings)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const allowedFields = ["namingTemplate", "transcriptionEngine", "transcriptionModel", "downloadThreads", "transcribeThreads", "gpuCount", "downloadsPaused", "transcriptionsPaused", "convertToOpus", "batchSize", "beamSize", "maxSpeakers", "diarizationModel", "diarizationEmbeddingBatchSize", "diarizationSegmentationBatchSize"]
    
    const updateData: any = {}
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field]
      }
    }

    const settings = await prisma.settings.upsert({
      where: { id: "global" },
      update: updateData,
      create: {
        id: "global",
        namingTemplate: "{podcast_title} - {episode_number}",
        transcriptionEngine: "insanely-fast-whisper",
        ...updateData
      }
    })
    
    return NextResponse.json(settings)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
