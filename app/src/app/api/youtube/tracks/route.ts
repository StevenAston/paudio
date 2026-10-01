import { NextResponse } from "next/server"
import { ytDlpJson } from "@/lib/youtube"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const videoId = searchParams.get("videoId")
  
  if (!videoId) {
    return NextResponse.json({ error: "videoId is required" }, { status: 400 })
  }

  try {
    const url = `https://youtube.com/watch?v=${videoId}`
    const info = await ytDlpJson(url) // without --flat-playlist to get all formats
    
    // Filter formats for audio
    const audioFormats = (info.formats || []).filter((f: any) => 
      f.acodec !== 'none' && f.vcodec === 'none'
    ).map((f: any) => ({
      format_id: f.format_id,
      ext: f.ext,
      acodec: f.acodec,
      abr: f.abr,
      filesize: f.filesize || f.filesize_approx,
      format_note: f.format_note
    }))

    // Subtitles
    const subs = info.subtitles || {}
    const autoSubs = info.automatic_captions || {}
    const subtitles = []
    
    for (const lang of Object.keys(subs)) {
      for (const sub of subs[lang]) {
        subtitles.push({
          lang,
          ext: sub.ext,
          name: sub.name || lang,
          isAuto: false
        })
      }
    }
    for (const lang of Object.keys(autoSubs)) {
      for (const sub of autoSubs[lang]) {
        subtitles.push({
          lang,
          ext: sub.ext,
          name: sub.name || `${lang} (auto)`,
          isAuto: true
        })
      }
    }

    return NextResponse.json({
      audioFormats,
      subtitles
    })

  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: error.message || "Failed to fetch tracks" }, { status: 500 })
  }
}
