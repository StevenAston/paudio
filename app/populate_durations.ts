import 'dotenv/config';
import { prisma } from './src/lib/prisma';
import Parser from 'rss-parser';

const parser = new Parser({
  customFields: {
    item: ["guid", "itunes:episode", "itunes:duration"],
  },
});

async function main() {
  const podcasts = await prisma.podcast.findMany({
    include: { episodes: true }
  });

  for (const podcast of podcasts) {
    console.log(`Fetching feed for ${podcast.title}...`);
    try {
      const feed = await parser.parseURL(podcast.feedUrl);
      
      for (const ep of podcast.episodes) {
        if (ep.duration === null) {
          const feedItem = feed.items.find(item => 
            (item.guid || (item as any).id || item.link || item.title) === ep.guid
          );

          if (feedItem && feedItem["itunes:duration"]) {
            let duration: number | null = null;
            const parts = feedItem["itunes:duration"].toString().split(':');
            if (parts.length === 3) {
              duration = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
            } else if (parts.length === 2) {
              duration = parseInt(parts[0]) * 60 + parseInt(parts[1]);
            } else {
              duration = parseInt(parts[0]);
            }

            if (!isNaN(duration!) && duration !== null) {
              await prisma.episode.update({
                where: { id: ep.id },
                data: { duration }
              });
              console.log(`Updated ${ep.title} duration: ${duration}s`);
            }
          }
        }
      }
    } catch (e: any) {
      console.error(`Failed to parse feed ${podcast.feedUrl}: ${e.message}`);
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Done");
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
