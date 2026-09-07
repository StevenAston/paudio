import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { prisma } from '../../../lib/prisma'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { duration = 15 } = body

    // Get current settings
    const globalSettings = await prisma.settings.findUnique({ where: { id: "global" } })
    const engine = globalSettings?.transcriptionEngine || "insanely-fast-whisper"
    const model = globalSettings?.transcriptionModel || "openai/whisper-large-v3-turbo"
    const batchSize = globalSettings?.batchSize || 4
    const beamSize = globalSettings?.beamSize || 5
    const maxSpeakers = globalSettings?.maxSpeakers || 4
    const diarizationModel = globalSettings?.diarizationModel || "pyannote/speaker-diarization-3.1"
    const embedBatchSize = globalSettings?.diarizationEmbeddingBatchSize || 1
    const segmentBatchSize = globalSettings?.diarizationSegmentationBatchSize || 1
    const gpuCount = globalSettings?.gpuCount || 1
    const transcribeThreads = globalSettings?.transcribeThreads || 1

    const scriptPath = path.join(process.cwd(), '..', 'scripts', 'benchmark.py')
    
    let pythonExe = "python"
    const isWindows = process.platform === "win32"
    const venvPythonPath = path.join(process.cwd(), "..", ".venv", isWindows ? "Scripts" : "bin", isWindows ? "python.exe" : "python")
    if (fs.existsSync(venvPythonPath)) {
      pythonExe = venvPythonPath
    }

    const cmdArgs = [
      scriptPath,
      '--duration', String(duration),
      '--engine', engine,
      '--model', model,
      '--batch-size', String(batchSize),
      '--beam-size', String(beamSize),
      '--max-speakers', String(maxSpeakers),
      '--diarization-model', diarizationModel,
      '--embed-batch-size', String(embedBatchSize),
      '--segment-batch-size', String(segmentBatchSize),
      '--gpu-count', String(gpuCount),
      '--transcribe-threads', String(transcribeThreads)
    ]

    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      start(controller) {
        const proc = spawn(pythonExe, cmdArgs, {
          env: process.env
        })

        proc.stdout.on('data', (data) => {
          controller.enqueue(encoder.encode(data.toString()))
        })

        proc.stderr.on('data', (data) => {
          controller.enqueue(encoder.encode(data.toString()))
        })

        proc.on('close', (code) => {
          if (code !== 0) {
            controller.enqueue(encoder.encode(`\nProcess exited with code ${code}`))
          }
          controller.close()
        })

        proc.on('error', (err) => {
          controller.enqueue(encoder.encode(`\nError: ${err.message}`))
          controller.close()
        })
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
