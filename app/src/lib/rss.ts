import Parser from "rss-parser"

const parser = new Parser({
  customFields: {
    item: ["guid", "itunes:episode", "itunes:duration"],
  },
})

export async function parsePodcastFeed(url: string) {
  try {
    const feed = await parser.parseURL(url)
    const validItems = feed.items.filter((item) => item.enclosure?.url)
    const count = validItems.length

    return {
      title: feed.title || "Unknown Podcast",
      description: feed.description || "",
      coverImageUrl: feed.image?.url || null,
      episodes: validItems.map((item, index) => {
        const defaultNum = count - index
        const itunesEp = item["itunes:episode"]
        const epNum = itunesEp ? parseInt(itunesEp) : defaultNum
        
        let duration = null
        if (item["itunes:duration"]) {
          const parts = item["itunes:duration"].toString().split(':')
          if (parts.length === 3) {
            duration = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
          } else if (parts.length === 2) {
            duration = parseInt(parts[0]) * 60 + parseInt(parts[1])
          } else {
            duration = parseInt(parts[0])
          }
          if (isNaN(duration)) duration = null
        }
        
        return {
          guid: item.guid || (item as any).id || item.link || item.title || "",
          episodeNumber: String(epNum).padStart(3, "0"),
          title: item.title || "Untitled Episode",
          duration: duration,
          audioUrl: item.enclosure?.url || "",
          publishDate: item.isoDate ? new Date(item.isoDate) : null,
        }
      }),
    }
  } catch (error) {
    console.error("Failed to parse RSS feed:", error)
    throw new Error("Invalid RSS feed or unable to fetch")
  }
}
