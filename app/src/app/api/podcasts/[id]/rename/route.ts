import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import fs from "fs"
import path from "path"

const AUDIO_DIR = path.join(process.cwd(), "..", "audio")
const TRANSCRIPT_DIR = path.join(process.cwd(), "..", "transcripts")

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const podcast = await prisma.podcast.findUnique({
      where: { id },
      include: { episodes: true }
    })
    
    if (!podcast) {
      return NextResponse.json({ error: "Podcast not found" }, { status: 404 })
    }

    const oldDirName = podcast.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()
    const newDirName = (podcast.customTitle || podcast.title).replace(/[^a-z0-9]/gi, '_').toLowerCase()
    
    let audioDir = path.join(AUDIO_DIR, oldDirName)
    let transDir = path.join(TRANSCRIPT_DIR, oldDirName)
    
    // Rename directories if the custom title changed the dir name
    if (oldDirName !== newDirName) {
      const newAudioDir = path.join(AUDIO_DIR, newDirName)
      if (fs.existsSync(audioDir) && !fs.existsSync(newAudioDir)) {
        fs.renameSync(audioDir, newAudioDir)
      }
      audioDir = newAudioDir

      const newTransDir = path.join(TRANSCRIPT_DIR, newDirName)
      if (fs.existsSync(transDir) && !fs.existsSync(newTransDir)) {
        fs.renameSync(transDir, newTransDir)
      }
      transDir = newTransDir
    }

    const template = podcast.namingTemplate || "{podcast_title} - {episode_title}"
    let renamedCount = 0

    for (const episode of podcast.episodes) {
      const pd = episode.publishDate ? new Date(episode.publishDate) : null
      const yyyy = pd ? pd.getFullYear().toString() : "0000"
      const mm = pd ? (pd.getMonth() + 1).toString().padStart(2, '0') : "00"
      const dd = pd ? pd.getDate().toString().padStart(2, '0') : "00"

      let newBaseName = template
        .replace(/{podcast_title}|{podcast_name}|{name}/gi, podcast.customTitle || podcast.title || "")
        .replace(/{episode_title}|{title}/gi, episode.title || "")
        .replace(/{episode_number}|{number}/gi, episode.episodeNumber || "")
        .replace(/{YYYY}/gi, yyyy)
        .replace(/{MM}/gi, mm)
        .replace(/{DD}/gi, dd)
        .replace(/[<>:"\/\\|?*]/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()

      const updates: any = {}
      
      // Handle Audio files
      if (episode.localAudioPath) {
        // Find existing file. It might be in oldDir or newDir depending on if dir was renamed.
        // But since we renamed dir above, it should now be in newDir, but the DB path still has oldDir!
        const oldExt = path.extname(episode.localAudioPath)
        const oldAudioBase = path.basename(episode.localAudioPath, oldExt)
        
        // We look for the file in the CURRENT audioDir (which is newAudioDir if renamed)
        const currentLoc = path.join(audioDir, `${oldAudioBase}${oldExt}`)
        const newAudioPath = path.join(audioDir, `${newBaseName}${oldExt}`)
        
        if (currentLoc !== newAudioPath || episode.localAudioPath !== newAudioPath) {
          if (fs.existsSync(currentLoc) && !fs.existsSync(newAudioPath)) {
            fs.renameSync(currentLoc, newAudioPath)
            updates.localAudioPath = newAudioPath
            
            const oldWavPath = path.join(audioDir, `${oldAudioBase}.wav`)
            const newWavPath = path.join(audioDir, `${newBaseName}.wav`)
            if (fs.existsSync(oldWavPath) && !fs.existsSync(newWavPath)) {
              fs.renameSync(oldWavPath, newWavPath)
            }
            renamedCount++
          } else if (!fs.existsSync(currentLoc) && fs.existsSync(newAudioPath)) {
            // It might already be renamed or matched, just update DB
            updates.localAudioPath = newAudioPath
          }
        }
      }

      // Handle Transcript files
      if (episode.localTranscriptPath) {
        const oldTransBase = path.basename(episode.localTranscriptPath, ".json")
        const currentLoc = path.join(transDir, `${oldTransBase}.json`)
        const newTransPath = path.join(transDir, `${newBaseName}.json`)
        
        if (currentLoc !== newTransPath || episode.localTranscriptPath !== newTransPath) {
          if (fs.existsSync(currentLoc) && !fs.existsSync(newTransPath)) {
            fs.renameSync(currentLoc, newTransPath)
            updates.localTranscriptPath = newTransPath
            
            const oldMd = path.join(transDir, `${oldTransBase}.md`)
            const newMd = path.join(transDir, `${newBaseName}.md`)
            if (fs.existsSync(oldMd) && !fs.existsSync(newMd)) fs.renameSync(oldMd, newMd)

            const oldTxt = path.join(transDir, `${oldTransBase}.txt`)
            const newTxt = path.join(transDir, `${newBaseName}.txt`)
            if (fs.existsSync(oldTxt) && !fs.existsSync(newTxt)) fs.renameSync(oldTxt, newTxt)
            
            renamedCount++
          } else if (!fs.existsSync(currentLoc) && fs.existsSync(newTransPath)) {
            updates.localTranscriptPath = newTransPath
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        await prisma.episode.update({
          where: { id: episode.id },
          data: updates
        })
      }
    }

    return NextResponse.json({ message: `Successfully renamed directories and files for ${renamedCount} episodes.` })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
