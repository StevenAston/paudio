import { spawn } from "child_process"
import path from "path"

export async function ytDlpJson(url: string, extraArgs: string[] = []): Promise<any> {
  return new Promise((resolve, reject) => {
    const args = ["-J", ...extraArgs, url]
    const proc = spawn("yt-dlp", args)
    
    let stdout = ""
    let stderr = ""
    
    proc.stdout.on("data", data => stdout += data.toString())
    proc.stderr.on("data", data => stderr += data.toString())
    
    proc.on("close", code => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout))
        } catch (e) {
          reject(new Error("Failed to parse yt-dlp JSON"))
        }
      } else {
        reject(new Error(`yt-dlp failed: ${stderr}`))
      }
    })
  })
}

export async function parseYoutubeUrl(url: string) {
  // First get the URL info
  const info = await ytDlpJson(url, ["--flat-playlist", "--playlist-end", "20"])
  
  if (info._type === "playlist") {
    // It's a channel or playlist
    return {
      channelInfo: info,
      videos: info.entries || [],
      pinnedVideoId: null
    }
  } else if (info._type === "video") {
    // It's a specific video
    // Get its channel URL
    const channelUrl = info.channel_url || info.uploader_url
    if (!channelUrl) {
      // Just return the video itself if we can't find a channel
      return {
        channelInfo: { title: info.uploader || "Unknown Channel", uploader_id: info.uploader_id },
        videos: [info],
        pinnedVideoId: info.id,
        specificVideoInfo: info
      }
    }
    
    // Fetch the channel's top 20 videos
    const channelInfo = await ytDlpJson(channelUrl, ["--flat-playlist", "--playlist-end", "20"])
    
    // Ensure the specific video is in the videos array
    let videos = channelInfo.entries || []
    if (!videos.some((v: any) => v.id === info.id)) {
      videos.unshift(info)
    }
    
    return {
      channelInfo,
      videos: videos,
      pinnedVideoId: info.id,
      specificVideoInfo: info
    }
  } else {
    throw new Error(`Unsupported yt-dlp type: ${info._type}`)
  }
}
