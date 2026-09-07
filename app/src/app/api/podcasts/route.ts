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

    const parsedData = await parsePodcastFeed(feedUrl)

    // Save podcast and episodes
    const podcast = await prisma.$transaction(async (tx) => {
      const p = await tx.podcast.upsert({
        where: { feedUrl },
        update: {
          title: parsedData.title,
          description: parsedData.description,
          coverImageUrl: parsedData.coverImageUrl,
        },
        create: {
          feedUrl,
          title: parsedData.title,
          description: parsedData.description,
          coverImageUrl: parsedData.coverImageUrl,
          namingTemplate: "{podcast_title} - {episode_number}", // Default template
        },
      })

      for (const ep of parsedData.episodes) {
        const episode = await tx.episode.upsert({
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
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to add podcast" }, { status: 500 })
  }
}
