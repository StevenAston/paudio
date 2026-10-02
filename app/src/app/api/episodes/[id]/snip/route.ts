import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import fs from "fs"
import path from "path"
import { spawn } from "child_process"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolvedParams = await params
    const { segments } = await request.json()
    // segments: Array<{start: number, end: number}> of ranges to REMOVE
    
    if (!Array.isArray(segments)) {
      return new NextResponse("Invalid segments", { status: 400 })
    }

    const episode = await prisma.episode.findUnique({
      where: { id: resolvedParams.id }
    })
    
    if (!episode || !episode.localAudioPath) {
      return new NextResponse("Audio not found", { status: 404 })
    }
    
    const filePath = episode.localAudioPath
    if (!fs.existsSync(filePath)) {
      return new NextResponse("File missing", { status: 404 })
    }

    if (segments.length === 0) {
      return NextResponse.json({ success: true, message: "No segments to remove" })
    }

    // Sort segments to remove
    const sortedRem = [...segments].sort((a, b) => a.start - b.start)
    
    // Calculate keep segments
    const keepSegments: Array<{start: number, end: number | null}> = []
    let current = 0
    for (const rem of sortedRem) {
      if (rem.start > current) {
        keepSegments.push({ start: current, end: rem.start })
      }
      current = Math.max(current, rem.end)
    }
    keepSegments.push({ start: current, end: null })

    let filterParts: string[] = []
    let outLabels: string[] = []
    
    keepSegments.forEach((keep, idx) => {
      let f = `[0:a]atrim=start=${keep.start}`
      if (keep.end !== null) f += `:end=${keep.end}`
      f += `,asetpts=PTS-STARTPTS[a${idx}]`
      filterParts.push(f)
      outLabels.push(`[a${idx}]`)
    })
    
    const filterComplex = filterParts.join('; ') + `; ${outLabels.join('')}concat=n=${keepSegments.length}:v=0:a=1[outa]`
    
    const ext = path.extname(filePath)
    const dir = path.dirname(filePath)
    const base = path.basename(filePath, ext)
    const tempFilePath = path.join(dir, `${base}_snip_temp${ext}`)

    await new Promise((resolve, reject) => {
      const ffmpegArgs = [
        "-y",
        "-i", filePath,
        "-filter_complex", filterComplex,
        "-map", "[outa]",
        tempFilePath
      ]
      
      const process = spawn("ffmpeg", ffmpegArgs)
      
      let stderr = ""
      process.stderr.on("data", (data) => {
        stderr += data.toString()
      })
      
      process.on("close", (code) => {
        if (code === 0) resolve(true)
        else reject(new Error(`FFmpeg failed with code ${code}:\n${stderr}`))
      })
    })

    // On success, overwrite the original file
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(filePath)
      fs.renameSync(tempFilePath, filePath)
    }

    // We might also need to update the episode duration, but typically it doesn't matter since the player or the transcode script handles the file directly.
    
    return NextResponse.json({ success: true, message: "Audio snipped successfully" })
    
  } catch (err: any) {
    console.error("Error snipping audio:", err)
    return new NextResponse(`Error snipping audio: ${err.message}`, { status: 500 })
  }
}
