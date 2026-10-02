import { GET, POST } from "./route";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parsePodcastFeed } from "@/lib/rss";
import * as youtube from "@/lib/youtube";

jest.mock("@/lib/prisma", () => {
  const mockPrisma: any = {
    podcast: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    episode: {
      upsert: jest.fn(),
    },
  };
  mockPrisma.$transaction = jest.fn((cb) => cb(mockPrisma));
  return { prisma: mockPrisma };
});

jest.mock("@/lib/rss", () => ({
  parsePodcastFeed: jest.fn(),
}));

jest.mock("@/lib/youtube", () => ({
  parseYoutubeUrl: jest.fn(),
}));

describe("Podcasts API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET", () => {
    it("returns podcasts list", async () => {
      const mockPodcasts = [{ id: 1, title: "Test Podcast" }];
      (prisma.podcast.findMany as jest.Mock).mockResolvedValue(mockPodcasts);

      const response = await GET();
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json).toEqual(mockPodcasts);
      expect(prisma.podcast.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { episodes: true } } },
      });
    });

    it("handles errors", async () => {
      (prisma.podcast.findMany as jest.Mock).mockRejectedValue(new Error("DB Error"));

      const response = await GET();
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json).toEqual({ error: "Failed to fetch podcasts" });
    });
  });

  describe("POST", () => {
    it("handles YouTube URLs", async () => {
      const request = new Request("http://localhost/api/podcasts", {
        method: "POST",
        body: JSON.stringify({ feedUrl: "https://youtube.com/watch?v=123" }),
      });

      const mockYoutubeData = {
        channelInfo: { title: "YT Channel", channel_url: "http://yt.com/channel/1" },
        videos: [
          { id: "v1", title: "Video 1", duration: 120, url: "http://yt.com/v1", upload_date: "20231015" },
        ],
        pinnedVideoId: "v1",
      };

      jest.spyOn(youtube, "parseYoutubeUrl").mockResolvedValue(mockYoutubeData);
      (prisma.podcast.upsert as jest.Mock).mockResolvedValue({ id: 1, title: "YT Channel" });

      const response = await POST(request);
      const json = await response.json();

      expect(youtube.parseYoutubeUrl).toHaveBeenCalledWith("https://youtube.com/watch?v=123");
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.podcast.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { feedUrl: "http://yt.com/channel/1" },
          update: expect.objectContaining({ title: "YT Channel", sourceType: "YOUTUBE" }),
        })
      );
      expect(prisma.episode.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { guid: "v1" },
          update: expect.objectContaining({ title: "Video 1", pinned: true }),
        })
      );
      expect(response.status).toBe(200);
      expect(json).toEqual({ id: 1, title: "YT Channel" });
    });

    it("handles RSS feed URLs", async () => {
      const request = new Request("http://localhost/api/podcasts", {
        method: "POST",
        body: JSON.stringify({ feedUrl: "https://some-podcast.com/feed.xml" }),
      });

      const mockRssData = {
        title: "RSS Podcast",
        description: "A cool podcast",
        coverImageUrl: "http://image.com/cover.jpg",
        episodes: [
          { guid: "e1", episodeNumber: 1, title: "Ep 1", duration: 300, audioUrl: "http://audio.com/e1.mp3", publishDate: new Date("2023-10-15") },
        ],
      };

      (parsePodcastFeed as jest.Mock).mockResolvedValue(mockRssData);
      (prisma.podcast.upsert as jest.Mock).mockResolvedValue({ id: 2, title: "RSS Podcast" });

      const response = await POST(request);
      const json = await response.json();

      expect(parsePodcastFeed).toHaveBeenCalledWith("https://some-podcast.com/feed.xml");
      expect(prisma.podcast.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { feedUrl: "https://some-podcast.com/feed.xml" },
          update: expect.objectContaining({ title: "RSS Podcast", sourceType: "RSS" }),
        })
      );
      expect(prisma.episode.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { guid: "e1" },
          update: expect.objectContaining({ title: "Ep 1" }),
        })
      );
      expect(response.status).toBe(200);
      expect(json).toEqual({ id: 2, title: "RSS Podcast" });
    });

    it("returns 400 if feedUrl is missing", async () => {
      const request = new Request("http://localhost/api/podcasts", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json).toEqual({ error: "Feed URL is required" });
    });
  });
});
