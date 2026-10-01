import { GET, POST } from "./route";
import { prisma } from "@/lib/prisma";
import fs from "fs/promises";

jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  prisma: {
    episode: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    podcast: { upsert: jest.fn() },
    jobQueue: { upsert: jest.fn() },
  },
}));
jest.mock("fs/promises", () => ({ __esModule: true, default: { readFile: jest.fn() } }));

const ID = "dQw4w9WgXcQ";
const post = (body: unknown) => POST(new Request("http://localhost/api/transcribe", { method: "POST", body: JSON.stringify(body) }));

describe("Transcribe API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({});
  });

  it("rejects ids that aren't YouTube video ids", async () => {
    expect((await post({ youtubeId: "--exec=evil" })).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/transcribe"))).status).toBe(400);
  });

  it("queues a new video and kicks the workers", async () => {
    (prisma.episode.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.podcast.upsert as jest.Mock).mockResolvedValue({ id: "p1" });
    (prisma.episode.create as jest.Mock).mockResolvedValue({ id: "e1" });

    const res = await post({ youtubeId: ID });

    expect(res.status).toBe(202);
    expect(prisma.episode.create).toHaveBeenCalledWith({ data: expect.objectContaining({ guid: ID, podcastId: "p1" }) });
    expect(prisma.jobQueue.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { episodeId: "e1" } }));
    expect(global.fetch).toHaveBeenCalledWith(new URL("http://localhost/api/worker"), { method: "POST" });
  });

  it("doesn't requeue a video already in flight", async () => {
    (prisma.episode.findUnique as jest.Mock).mockResolvedValue({ id: "e1", transcribeStatus: "TRANSCRIBING" });
    expect(await (await post({ youtubeId: ID })).json()).toEqual({ status: "TRANSCRIBING" });
    expect(prisma.jobQueue.upsert).not.toHaveBeenCalled();
  });

  it("normalises both transcript shapes to timed segments", async () => {
    (prisma.episode.findUnique as jest.Mock).mockResolvedValue({ transcribeStatus: "TRANSCRIBED", localTranscriptPath: "/t.json" });
    const get = async () => (await GET(new Request(`http://localhost/api/transcribe?youtubeId=${ID}`))).json();

    (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ segments: [{ start: 0, end: 2, text: " Hello " }] }));
    expect(await get()).toEqual({ status: "TRANSCRIBED", segments: [{ start: 0, end: 2, text: "Hello" }] });

    (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ chunks: [{ timestamp: [5, null], text: "end" }] }));
    expect((await get()).segments).toEqual([{ start: 5, end: 5, text: "end" }]);
  });
});
