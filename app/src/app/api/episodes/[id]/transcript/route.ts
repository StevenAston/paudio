import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import fs from "fs/promises"
import path from "path"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const episode = await prisma.episode.findUnique({
      where: { id }
    })

    if (!episode) {
      return NextResponse.json({ error: "Episode not found" }, { status: 404 })
    }

    if (!episode.localTranscriptPath) {
      return NextResponse.json({ error: "No transcript available" }, { status: 404 })
    }

    // Try to find the .json file
    let jsonPath = episode.localTranscriptPath
    if (jsonPath.endsWith('.md') || jsonPath.endsWith('.txt')) {
      jsonPath = jsonPath.substring(0, jsonPath.lastIndexOf('.')) + '.json'
    } else if (!jsonPath.endsWith('.json')) {
      jsonPath += '.json'
    }
    
    // If localTranscriptPath is just a directory, we'd have a problem, but it usually is the file itself or base path.
    // Let's ensure it's absolute
    if (!path.isAbsolute(jsonPath)) {
       // if relative, maybe relative to project root?
       jsonPath = path.join(process.cwd(), "..", jsonPath)
    }

    try {
      const data = await fs.readFile(jsonPath, "utf-8")
      return NextResponse.json(JSON.parse(data))
    } catch (e: any) {
      return NextResponse.json({ error: "Failed to read transcript file", details: e.message, path: jsonPath }, { status: 500 })
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
