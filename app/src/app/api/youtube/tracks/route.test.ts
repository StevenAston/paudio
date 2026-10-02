import { GET } from "./route";
import * as youtube from "@/lib/youtube";

jest.mock("@/lib/youtube", () => ({
  __esModule: true,
  ytDlpJson: jest.fn(),
}));

describe("YouTube Tracks API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 if videoId is missing", async () => {
    const request = new Request("http://localhost/api/youtube/tracks");
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({ error: "videoId is required" });
  });

  it("parses audio formats and subtitles correctly", async () => {
    const request = new Request("http://localhost/api/youtube/tracks?videoId=123");
    
    const mockYtInfo = {
      formats: [
        { format_id: "140", ext: "m4a", acodec: "mp4a.40.2", vcodec: "none", abr: 128, filesize: 1000, format_note: "medium" },
        { format_id: "248", ext: "webm", acodec: "none", vcodec: "vp9", abr: 0, filesize: 2000 }, // video only
        { format_id: "251", ext: "webm", acodec: "opus", vcodec: "none", abr: 160, filesize_approx: 1500 },
      ],
      subtitles: {
        en: [{ ext: "vtt", name: "English" }],
      },
      automatic_captions: {
        fr: [{ ext: "vtt" }],
      }
    };

    (youtube.ytDlpJson as jest.Mock).mockResolvedValue(mockYtInfo);

    const response = await GET(request);
    const json = await response.json();

    expect(youtube.ytDlpJson).toHaveBeenCalledWith("https://youtube.com/watch?v=123");
    expect(response.status).toBe(200);
    
    // Check audio formats (should filter out video only)
    expect(json.audioFormats).toHaveLength(2);
    expect(json.audioFormats[0]).toEqual({
      format_id: "140", ext: "m4a", acodec: "mp4a.40.2", abr: 128, filesize: 1000, format_note: "medium"
    });
    expect(json.audioFormats[1]).toEqual({
      format_id: "251", ext: "webm", acodec: "opus", abr: 160, filesize: 1500, format_note: undefined
    });

    // Check subtitles
    expect(json.subtitles).toHaveLength(2);
    expect(json.subtitles).toContainEqual({
      lang: "en", ext: "vtt", name: "English", isAuto: false
    });
    expect(json.subtitles).toContainEqual({
      lang: "fr", ext: "vtt", name: "fr (auto)", isAuto: true
    });
  });

  it("handles yt-dlp error", async () => {
    const request = new Request("http://localhost/api/youtube/tracks?videoId=123");
    
    (youtube.ytDlpJson as jest.Mock).mockRejectedValue(new Error("yt-dlp failed"));

    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json).toEqual({ error: "yt-dlp failed" });
  });
});
