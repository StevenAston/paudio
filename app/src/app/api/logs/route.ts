import { NextResponse } from "next/server"
import fs from "fs"
import path from "path"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const logPath = path.join(process.cwd(), "..", "paudio.log") // Assuming root is one level up from app
    
    // Fallback if not there
    if (!fs.existsSync(logPath)) {
      return NextResponse.json({ lines: ["Log file not found."] })
    }

    const stat = fs.statSync(logPath)
    const chunkSize = Math.min(65536, stat.size) // read up to 64KB
    const position = stat.size - chunkSize

    const buffer = Buffer.alloc(chunkSize)
    const fd = fs.openSync(logPath, 'r')
    fs.readSync(fd, buffer, 0, chunkSize, position)
    fs.closeSync(fd)

    let content = buffer.toString('utf-8')
    
    // If we didn't read from the very beginning, drop the first partial line
    if (position > 0) {
      const firstNewline = content.indexOf('\n')
      if (firstNewline !== -1) {
        content = content.substring(firstNewline + 1)
      }
    }

    return NextResponse.json({ lines: content.split('\n') })
  } catch (error: any) {
    return NextResponse.json({ error: "Failed to read logs", details: error.message }, { status: 500 })
  }
}
