import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { parsePodcastFeed } from "@/lib/rss"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const podcasts = await prisma.podcast.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { episodes: true }
        }
      }
    })
    return NextResponse.json(podcasts)
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch podcasts" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { feedUrl } = await request.json()
    if (!feedUrl) return NextResponse.json({ error: "Feed URL is required" }, { status: 400 })

    const isYoutube = feedUrl.includes("youtube.com") || feedUrl.includes("youtu.be")
    
    if (isYoutube) {
      // Lazy load to avoid import issues on client
      const { parseYoutubeUrl } = await import("@/lib/youtube")
      const { channelInfo, videos, pinnedVideoId } = await parseYoutubeUrl(feedUrl)
      
      const channelId = channelInfo.id || channelInfo.uploader_id || feedUrl
      
      const podcast = await prisma.$transaction(async (tx) => {
        const p = await tx.podcast.upsert({
          where: { feedUrl: channelInfo.channel_url || feedUrl },
          update: {
            title: channelInfo.title || "Youtube Channel",
            description: channelInfo.description || "",
            sourceType: "YOUTUBE",
            youtubeChannelId: channelId
          },
          create: {
            feedUrl: channelInfo.channel_url || feedUrl,
            title: channelInfo.title || "Youtube Channel",
            description: channelInfo.description || "",
            namingTemplate: "{title}", 
            sourceType: "YOUTUBE",
            youtubeChannelId: channelId
          },
        })

        for (const ep of videos) {
          const isPinned = ep.id === pinnedVideoId
          const pubDate = ep.upload_date ? new Date(
            ep.upload_date.substring(0,4) + "-" + 
            ep.upload_date.substring(4,6) + "-" + 
            ep.upload_date.substring(6,8)
          ) : new Date()

          await tx.episode.upsert({
            where: { guid: ep.id },
            update: {
              title: ep.title,
              duration: ep.duration,
              audioUrl: ep.url || `https://youtube.com/watch?v=${ep.id}`,
              publishDate: pubDate,
              youtubeVideoId: ep.id,
              pinned: isPinned
            },
            create: {
              guid: ep.id,
              title: ep.title,
              duration: ep.duration,
              audioUrl: ep.url || `https://youtube.com/watch?v=${ep.id}`,
              publishDate: pubDate,
              podcastId: p.id,
              youtubeVideoId: ep.id,
              pinned: isPinned
            },
          })
        }
        return p
      })
      return NextResponse.json(podcast)
    } else {
      const parsedData = await parsePodcastFeed(feedUrl)

      // Save podcast and episodes
      const podcast = await prisma.$transaction(async (tx) => {
        const p = await tx.podcast.upsert({
          where: { feedUrl },
          update: {
            title: parsedData.title,
            description: parsedData.description,
            coverImageUrl: parsedData.coverImageUrl,
            sourceType: "RSS"
          },
          create: {
            feedUrl,
            title: parsedData.title,
            description: parsedData.description,
            coverImageUrl: parsedData.coverImageUrl,
            namingTemplate: "{podcast_title} - {episode_number}", // Default template
            sourceType: "RSS"
          },
        })

        for (const ep of parsedData.episodes) {
          await tx.episode.upsert({
            where: { guid: ep.guid },
            update: {
              episodeNumber: ep.episodeNumber,
              title: ep.title,
              duration: ep.duration,
              audioUrl: ep.audioUrl,
              publishDate: ep.publishDate,
            },
            create: {
              guid: ep.guid,
              episodeNumber: ep.episodeNumber,
              title: ep.title,
              duration: ep.duration,
              audioUrl: ep.audioUrl,
              publishDate: ep.publishDate,
              podcastId: p.id,
            },
          })
        }
        return p
      })

      return NextResponse.json(podcast)
    }
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to add podcast/channel" }, { status: 500 })
  }
}
