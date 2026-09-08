import { prisma } from "./prisma"
import fs from "fs"
import path from "path"
import { spawn } from "child_process"
import { pipeline } from "stream/promises"
import { Transform } from "stream"

const AUDIO_DIR = path.join(process.cwd(), "..", "audio")
const TRANSCRIPT_DIR = path.join(process.cwd(), "..", "transcripts")
const LOG_FILE = path.join(process.cwd(), "..", "paudio.log")

function writeLog(msg: string) {
  console.log(msg)
  fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`)
}

export async function processNextDownload() {
  const globalSettings = await prisma.settings.findUnique({ where: { id: "global" } })
  if (globalSettings?.downloadsPaused) {
    return false // paused globally
  }

  // Find and claim a pending download job atomically
  const job = await prisma.$transaction(async (tx) => {
    const pendingJob = await tx.jobQueue.findFirst({
      where: { status: "PENDING", progress: { lt: 50 } },
      orderBy: { createdAt: "asc" },
      include: { episode: { include: { podcast: true } } }
    })
    
    if (!pendingJob) return null

    return tx.jobQueue.update({
      where: { id: pendingJob.id },
      data: { status: "IN_PROGRESS" },
      include: { episode: { include: { podcast: true } } }
    })
  })

  if (!job) return false

  try {
    const podcastTitleStr = job.episode.podcast.customTitle || job.episode.podcast.title
    const podcastDirName = podcastTitleStr.replace(/[^a-z0-9]/gi, '_').toLowerCase()
    
    const pd = job.episode.publishDate ? new Date(job.episode.publishDate) : null
    const yyyy = pd ? pd.getFullYear().toString() : "0000"
    const mm = pd ? (pd.getMonth() + 1).toString().padStart(2, '0') : "00"
    const dd = pd ? pd.getDate().toString().padStart(2, '0') : "00"

    let baseFileName = job.episode.podcast.namingTemplate || "{podcast_title} - {episode_title}"
    baseFileName = baseFileName
      .replace(/{podcast_title}|{podcast_name}|{name}/gi, podcastTitleStr || "")
      .replace(/{episode_title}|{title}/gi, job.episode.title || "")
      .replace(/{episode_number}|{number}/gi, job.episode.episodeNumber || "")
      .replace(/{YYYY}/gi, yyyy)
      .replace(/{MM}/gi, mm)
      .replace(/{DD}/gi, dd)
      .replace(/[<>:"\/\\|?*]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()

    const podcastAudioDir = path.join(AUDIO_DIR, podcastDirName)
    
    if (!fs.existsSync(podcastAudioDir)) fs.mkdirSync(podcastAudioDir, { recursive: true })

    let audioPath = path.join(podcastAudioDir, `${baseFileName}.mp3`)

    writeLog(`[WORKER] Preparing audio: ${job.episode.audioUrl}`)
    await prisma.episode.update({
      where: { id: job.episodeId },
      data: { downloadStatus: "DOWNLOADING" }
    })

    const existingPath = job.episode.localAudioPath
    const skipDownload = (existingPath && fs.existsSync(existingPath)) || fs.existsSync(audioPath)
    
    if (skipDownload) {
      if (existingPath && fs.existsSync(existingPath)) audioPath = existingPath
      writeLog(`[WORKER] Audio file already exists: ${audioPath}, skipping download.`)
    } else {
      const res = await fetch(job.episode.audioUrl)
    if (!res.ok) throw new Error(`Failed to fetch audio: ${res.statusText}`)
    
    const checkJob = await prisma.jobQueue.findUnique({ where: { id: job.id } })
    if (checkJob?.status === "PAUSED") {
      writeLog(`[WORKER] Job paused during download start.`)
      // Set status back to PENDING so it can be resumed
      await prisma.jobQueue.update({ where: { id: job.id }, data: { status: "PENDING" } })
      return true
    }

    const fileStream = fs.createWriteStream(audioPath)
    if (res.body) {
      const totalBytes = parseInt(res.headers.get("content-length") || "0", 10)
      let downloadedBytes = 0
      let lastUpdate = 0

      const progressStream = new Transform({
        transform(chunk, encoding, callback) {
          downloadedBytes += chunk.length
          if (totalBytes > 0) {
            const now = Date.now()
            if (now - lastUpdate > 1000) {
              lastUpdate = now
              const percent = (downloadedBytes / totalBytes) * 25
              prisma.jobQueue.update({
                where: { id: job.id },
                data: { progress: percent }
              }).catch(() => {})
            }
          }
          callback(null, chunk)
        }
      })

      // @ts-ignore
      await pipeline(res.body, progressStream, fileStream)
    }
    } // closes else block for skipDownload

    const wavPath = audioPath.replace(/\.[^/.]+$/, ".wav")

    writeLog(`[WORKER] Converting to WAV to bypass TorchCodec/FFmpeg binding issues...`)
    await prisma.jobQueue.update({
      where: { id: job.id },
      data: { progress: 25.0 }
    }).catch(() => {})
    
    await new Promise((resolve, reject) => {
      const ffmpegProcess = spawn("ffmpeg", [
        "-y",
        "-i", audioPath,
        "-ar", "16000",
        "-ac", "1",
        "-c:a", "pcm_s16le",
        wavPath
      ])

      ffmpegProcess.on("close", (code) => {
        if (code === 0) resolve(true)
        else reject(new Error(`FFmpeg conversion failed with code ${code}`))
      })
    })

    // We now keep the original audioPath (mp3) and don't overwrite it with wavPath
    // so that localAudioPath points to the original file.
    
    writeLog(`[WORKER] Audio ready: ${audioPath} (WAV prepared for transcription)`)

    await prisma.episode.update({
      where: { id: job.episodeId },
      data: { downloadStatus: "DOWNLOADED", localAudioPath: audioPath }
    })

    // Update progress to 50% and put it back to PENDING so transcription can pick it up
    await prisma.jobQueue.update({
      where: { id: job.id },
      data: { progress: 50.0, status: "PENDING" }
    })
    
    return true

  } catch (error: any) {
    writeLog(`[WORKER] Error processing download: ${error}`)
    
    let errMsg = error.message || String(error)
    if (error.stderr) errMsg = error.stderr.toString()
    
    await prisma.jobQueue.update({
      where: { id: job.id },
      data: { status: "ERROR", errorMessage: errMsg }
    })
    await prisma.episode.update({
      where: { id: job.episodeId },
      data: { downloadStatus: "ERROR" }
    })
    return true
  }
}

export async function processNextTranscription(workerIndex: number = 0) {
  const globalSettings = await prisma.settings.findUnique({ where: { id: "global" } })
  if (globalSettings?.transcriptionsPaused) {
    return false // paused globally
  }

  // Find and claim a pending transcription job atomically
  const job = await prisma.$transaction(async (tx) => {
    const pendingJob = await tx.jobQueue.findFirst({
      where: { status: "PENDING", progress: { gte: 50 } },
      orderBy: { createdAt: "asc" }
    })
    
    if (!pendingJob) return null

    // Ensure we are the only one claiming this job
    const updated = await tx.jobQueue.updateMany({
      where: { id: pendingJob.id, status: "PENDING" },
      data: { status: "IN_PROGRESS" }
    })
    
    if (updated.count === 0) return null
    
    // Now return the full job object with includes
    return tx.jobQueue.findUnique({
      where: { id: pendingJob.id },
      include: { episode: { include: { podcast: true } } }
    })
  })

  if (!job) return false

  writeLog(`\n[WORKER] Starting transcription job: ${job.episode.title}`)

  try {
    const podcastTitleStr = job.episode.podcast.customTitle || job.episode.podcast.title
    const podcastDirName = podcastTitleStr.replace(/[^a-z0-9]/gi, '_').toLowerCase()
    
    const pd = job.episode.publishDate ? new Date(job.episode.publishDate) : null
    const yyyy = pd ? pd.getFullYear().toString() : "0000"
    const mm = pd ? (pd.getMonth() + 1).toString().padStart(2, '0') : "00"
    const dd = pd ? pd.getDate().toString().padStart(2, '0') : "00"

    let baseFileName = job.episode.podcast.namingTemplate || "{podcast_title} - {episode_title}"
    baseFileName = baseFileName
      .replace(/{podcast_title}|{podcast_name}|{name}/gi, podcastTitleStr || "")
      .replace(/{episode_title}|{title}/gi, job.episode.title || "")
      .replace(/{episode_number}|{number}/gi, job.episode.episodeNumber || "")
      .replace(/{YYYY}/gi, yyyy)
      .replace(/{MM}/gi, mm)
      .replace(/{DD}/gi, dd)
      .replace(/[<>:"\/\\|?*]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()

    const podcastTransDir = path.join(TRANSCRIPT_DIR, podcastDirName)
    if (!fs.existsSync(podcastTransDir)) fs.mkdirSync(podcastTransDir, { recursive: true })

    const audioPath = job.episode.localAudioPath
    if (!audioPath || !fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`)
    }
    
    const wavPath = audioPath.replace(/\.[^/.]+$/, ".wav") // Replaces extension with .wav
    if (!fs.existsSync(wavPath)) {
      throw new Error(`WAV file not found for transcription: ${wavPath}`)
    }

    const transcriptPath = path.join(podcastTransDir, `${baseFileName}.json`)

    const checkJob2 = await prisma.jobQueue.findUnique({ where: { id: job.id } })
    if (checkJob2?.status === "PAUSED") {
      writeLog(`[WORKER] Job paused before transcription.`)
      await prisma.jobQueue.update({ where: { id: job.id }, data: { status: "PENDING" } })
      return true
    }

    writeLog(`[WORKER] Starting transcription engine...`)
    await prisma.episode.update({
      where: { id: job.episodeId },
      data: { transcribeStatus: "TRANSCRIBING" }
    })
    
    const engine = globalSettings?.transcriptionEngine || "insanely-fast-whisper"
    const modelFull = globalSettings?.transcriptionModel || "openai/whisper-large-v3-turbo"
    const scriptName = engine === "whisperx" ? "transcribe_whisperx.py"
      : engine === "faster-whisper" ? "transcribe_faster_whisper.py"
      : "transcribe.py"
      
    // For faster-whisper/whisperx, we need CTranslate2 format. 
    // If it's an OpenAI model, strip the prefix so faster-whisper uses its internal alias.
    // Otherwise, keep the full HuggingFace ID. We also auto-correct distil-whisper to the -ct2 repo.
    let modelArg = modelFull;
    if (engine === "faster-whisper" || engine === "whisperx") {
      if (modelFull.startsWith("openai/")) {
        modelArg = modelFull.split("/").pop()?.replace(/^whisper-/, "") || modelFull;
      } else if (modelFull === "distil-whisper/distil-large-v3.5" || modelFull === "distil-large-v3.5") {
        modelArg = "distil-whisper/distil-large-v3.5-ct2";
      }
    }

    const pythonScript = path.join(process.cwd(), "..", "scripts", scriptName)
    
    let pythonExe = "python"
    const isWindows = process.platform === "win32"
    const venvPythonPath = path.join(process.cwd(), "..", ".venv", isWindows ? "Scripts" : "bin", isWindows ? "python.exe" : "python")
    if (fs.existsSync(venvPythonPath)) {
      pythonExe = venvPythonPath
    }
    
    // Calculate target GPU based on worker index and GPU count
    const gpuCount = globalSettings?.gpuCount || 1
    const targetGpu = workerIndex % Math.max(1, gpuCount)
    
    await new Promise((resolve, reject) => {
      const pythonArgs = [
        pythonScript,
        "--audio", wavPath,
        "--output", transcriptPath,
        "--model", modelArg!,
        "--batch-size", String(globalSettings?.batchSize || 4),
        "--beam-size", String(globalSettings?.beamSize || 5),
        "--max-speakers", String(globalSettings?.maxSpeakers || 4),
        "--diarization-model", globalSettings?.diarizationModel || "pyannote/speaker-diarization-3.1",
        "--embed-batch-size", String(globalSettings?.diarizationEmbeddingBatchSize || 1),
        "--segment-batch-size", String(globalSettings?.diarizationSegmentationBatchSize || 1)
      ]
      
      const hfToken = process.env.HUGGINGFACE_TOKEN || process.env.HF_TOKEN
      if (hfToken) {
        pythonArgs.push("--hf-token", hfToken)
      }

      const pythonProcess = spawn(pythonExe, pythonArgs, {
        env: {
          ...process.env,
          CUDA_VISIBLE_DEVICES: String(targetGpu)
        }
      })

      let lastProgressUpdate = 0
      let currentStage = "TRANSCRIBING"
      
      pythonProcess.stdout.on("data", (data) => {
        const text = data.toString()
        writeLog(`[WHISPER]: ${text.trim()}`)
        
        // Parse faster-whisper timestamps like: [10.5s]
        const match = text.match(/\[([\d\.]+)s\]/)
        if (match && job.episode.duration) {
          const currentSeconds = parseFloat(match[1])
          const percent = Math.min(100, (currentSeconds / job.episode.duration) * 100)
          const now = Date.now()
          if (now - lastProgressUpdate > 1000) {
            lastProgressUpdate = now
            const totalProgress = 50 + (percent / 4)
            prisma.jobQueue.update({
              where: { id: job.id },
              data: { progress: totalProgress }
            }).catch(() => {})
          }
        }
      })

      pythonProcess.stderr.on("data", (data) => {
        const text = data.toString()
        writeLog(`[WHISPER-LOG]: ${text.trim()}`)
        if (text.includes("[STAGE] DIARIZATION")) {
          currentStage = "DIARIZING"
          prisma.jobQueue.update({
            where: { id: job.id },
            data: { progress: 75.0 }
          }).catch(() => {})
        }
        
        // Strip ANSI escape codes to parse rich progress bars cleanly
        const cleanText = text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
        
        // Parse tqdm or rich output like: 45%
        const match = cleanText.match(/\b(\d+)%/)
        if (match) {
          const percent = parseInt(match[1], 10)
          const now = Date.now()
          if (now - lastProgressUpdate > 1000) {
            lastProgressUpdate = now
            let totalProgress = 50
            if (currentStage === "TRANSCRIBING") {
              totalProgress = 50 + (percent / 4) // Scale 0-100 to 50-75
            } else if (currentStage === "DIARIZING") {
              totalProgress = 75 + (percent / 4) // Scale 0-100 to 75-100
            }
            
            prisma.jobQueue.update({
              where: { id: job.id },
              data: { progress: totalProgress }
            }).catch(() => {})
          }
        }
      })

      pythonProcess.on("close", (code) => {
        if (code === 0) resolve(true)
        else reject(new Error(`Transcription failed with code ${code}`))
      })
    })

    writeLog(`[WORKER] Transcription complete: ${transcriptPath}`)
    
    try {
      if (fs.existsSync(transcriptPath)) {
        const transcriptData = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'))
        const generationTime = new Date().toLocaleString()
        let mdContent = `# Transcript: ${job.episode.title}\n*Generated on: ${generationTime}*\n\n`
        let txtContent = `Transcript: ${job.episode.title}\nGenerated on: ${generationTime}\n\n`
        
        const segments = transcriptData.segments || transcriptData.chunks || []
        
        for (const seg of segments) {
          const start = seg.start !== undefined ? seg.start : (seg.timestamp ? seg.timestamp[0] : 0)
          const speaker = seg.speaker || "UNKNOWN"
          const text = (seg.text || "").trim()
          
          const timeFormatted = new Date(start * 1000).toISOString().substring(11, 19)
          
          mdContent += `**[${timeFormatted}] ${speaker}:** ${text}\n\n`
          txtContent += `[${timeFormatted}] ${speaker}: ${text}\n`
        }
        
        const mdPath = transcriptPath.replace(".json", ".md")
        const txtPath = transcriptPath.replace(".json", ".txt")
        
        fs.writeFileSync(mdPath, mdContent)
        fs.writeFileSync(txtPath, txtContent)
        
        writeLog(`[WORKER] Generated .md and .txt transcripts.`)
      }
    } catch (err: any) {
      writeLog(`[WORKER] Warning: Failed to generate .md/.txt: ${err.message}`)
    }

    // Defer the deletion to the finally block to ensure it happens even on error

    if (globalSettings?.convertToOpus) {
      writeLog(`[WORKER] Converting original audio to OPUS to save space (background)...`)
      const opusPath = audioPath.replace(/\.[^/.]+$/, ".opus")
      
      await prisma.jobQueue.update({
        where: { id: job.id },
        data: { status: "COMPRESSING", progress: 0 }
      })

      // Fire and forget OPUS conversion
      ;(async () => {
        try {
          await new Promise((resolve, reject) => {
            const ffmpegProcess = spawn("ffmpeg", [
              "-y",
              "-i", audioPath,
              "-c:a", "libopus",
              "-b:a", "32k", // reasonable bitrate for spoken word podcasts
              opusPath
            ])
            
            let lastUpdate = 0
            ffmpegProcess.stderr.on("data", (data) => {
                const text = data.toString()
                const match = text.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/)
                if (match && job.episode.duration) {
                    const hrs = parseInt(match[1], 10)
                    const mins = parseInt(match[2], 10)
                    const secs = parseFloat(match[3])
                    const currentSecs = hrs * 3600 + mins * 60 + secs
                    const percent = Math.min(100, (currentSecs / job.episode.duration) * 100)
                    const now = Date.now()
                    if (now - lastUpdate > 1000) {
                        lastUpdate = now
                        prisma.jobQueue.update({
                            where: { id: job.id },
                            data: { progress: percent }
                        }).catch(() => {})
                    }
                }
            })
            
            ffmpegProcess.on("close", (code) => {
              if (code === 0) resolve(true)
              else reject(new Error(`FFmpeg OPUS conversion failed with code ${code}`))
            })
          })
          
          if (fs.existsSync(audioPath)) {
            fs.unlinkSync(audioPath)
            writeLog(`[WORKER] Deleted original audio file, kept OPUS: ${opusPath}`)
          }
          
          await prisma.episode.update({
            where: { id: job.episodeId },
            data: { transcribeStatus: "TRANSCRIBED", localTranscriptPath: transcriptPath, localAudioPath: opusPath }
          })

          writeLog(`[WORKER] Job successfully completed!`)
          await prisma.jobQueue.update({
            where: { id: job.id },
            data: { status: "COMPLETED", progress: 100.0 }
          })
        } catch (e: any) {
          writeLog(`[WORKER] Warning: Opus conversion failed: ${e.message}`)
          await prisma.jobQueue.update({
            where: { id: job.id },
            data: { status: "ERROR", errorMessage: e.message }
          })
        }
      })()

      return true
    } else {
      await prisma.episode.update({
        where: { id: job.episodeId },
        data: { transcribeStatus: "TRANSCRIBED", localTranscriptPath: transcriptPath, localAudioPath: audioPath }
      })

      writeLog(`[WORKER] Job successfully completed!`)
      await prisma.jobQueue.update({
        where: { id: job.id },
        data: { status: "COMPLETED", progress: 100.0 }
      })
      
      return true
    }

  } catch (error: any) {
    writeLog(`[WORKER] Error processing transcription: ${error}`)
    
    let errMsg = error.message || String(error)
    if (error.stderr) errMsg = error.stderr.toString()
    
    await prisma.jobQueue.update({
      where: { id: job.id },
      data: { status: "ERROR", errorMessage: errMsg }
    })
    await prisma.episode.update({
      where: { id: job.episodeId },
      data: { transcribeStatus: "ERROR" }
    })
    return true
  } finally {
    // Attempt cleanup of the wav file regardless of success or failure
    if (job?.episode?.localAudioPath) {
      const wavPathCleanup = job.episode.localAudioPath.replace(/\.[^/.]+$/, ".wav")
      if (fs.existsSync(wavPathCleanup)) {
        try {
          fs.unlinkSync(wavPathCleanup)
          writeLog(`[WORKER] Cleaned up temporary WAV file: ${wavPathCleanup}`)
        } catch (e: any) {
          writeLog(`[WORKER] Warning: Failed to clean up WAV file: ${e.message}`)
        }
      }
    }
  }
}
