import { spawn } from "child_process";
import { ytDlpJson, parseYoutubeUrl } from "./youtube";

jest.mock("child_process");

describe("youtube", () => {
  let mockSpawn: jest.Mock;
  
  beforeEach(() => {
    jest.resetAllMocks();
    mockSpawn = spawn as jest.Mock;
  });

  describe("ytDlpJson", () => {
    it("parses valid JSON from stdout", async () => {
      const mockChildProcess = {
        stdout: { on: jest.fn((event, cb) => { if (event === "data") cb(Buffer.from(JSON.stringify({ title: "Test" }))); }) },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => { if (event === "close") cb(0); })
      };
      mockSpawn.mockReturnValue(mockChildProcess);

      const result = await ytDlpJson("http://youtube.com/watch?v=123");
      expect(mockSpawn).toHaveBeenCalledWith("yt-dlp", ["-J", "http://youtube.com/watch?v=123"]);
      expect(result).toEqual({ title: "Test" });
    });

    it("rejects when exit code is not 0", async () => {
      const mockChildProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn((event, cb) => { if (event === "data") cb(Buffer.from("error message")); }) },
        on: jest.fn((event, cb) => { if (event === "close") cb(1); })
      };
      mockSpawn.mockReturnValue(mockChildProcess);

      await expect(ytDlpJson("http://youtube.com/watch?v=123")).rejects.toThrow("yt-dlp failed: error message");
    });
    
    it("rejects when JSON parsing fails", async () => {
      const mockChildProcess = {
        stdout: { on: jest.fn((event, cb) => { if (event === "data") cb(Buffer.from("invalid json")); }) },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => { if (event === "close") cb(0); })
      };
      mockSpawn.mockReturnValue(mockChildProcess);

      await expect(ytDlpJson("http://youtube.com/watch?v=123")).rejects.toThrow("Failed to parse yt-dlp JSON");
    });
  });

  describe("parseYoutubeUrl", () => {
    it("returns channel info for a playlist", async () => {
      const mockPlaylist = { _type: "playlist", entries: [{ id: "v1" }, { id: "v2" }] };
      const mockChildProcess = {
        stdout: { on: jest.fn((event, cb) => { if (event === "data") cb(Buffer.from(JSON.stringify(mockPlaylist))); }) },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => { if (event === "close") cb(0); })
      };
      mockSpawn.mockReturnValue(mockChildProcess);

      const result = await parseYoutubeUrl("http://youtube.com/playlist?list=123");
      expect(result).toEqual({
        channelInfo: mockPlaylist,
        videos: mockPlaylist.entries,
        pinnedVideoId: null
      });
    });

    it("returns video info when channel is not found", async () => {
      const mockVideo = { _type: "video", id: "v1", uploader: "Test Channel", uploader_id: "uc123" };
      const mockChildProcess = {
        stdout: { on: jest.fn((event, cb) => { if (event === "data") cb(Buffer.from(JSON.stringify(mockVideo))); }) },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => { if (event === "close") cb(0); })
      };
      mockSpawn.mockReturnValue(mockChildProcess);

      const result = await parseYoutubeUrl("http://youtube.com/watch?v=123");
      expect(result).toEqual({
        channelInfo: { title: "Test Channel", uploader_id: "uc123" },
        videos: [mockVideo],
        pinnedVideoId: "v1",
        specificVideoInfo: mockVideo
      });
    });

    it("fetches channel info when specific video has channel_url", async () => {
      const mockVideo = { _type: "video", id: "v1", channel_url: "http://youtube.com/channel/123" };
      const mockChannel = { _type: "playlist", entries: [{ id: "v2" }] };
      
      let callCount = 0;
      const mockChildProcess1 = {
        stdout: { on: jest.fn((event, cb) => { if (event === "data") cb(Buffer.from(JSON.stringify(mockVideo))); }) },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => { if (event === "close") cb(0); })
      };
      const mockChildProcess2 = {
        stdout: { on: jest.fn((event, cb) => { if (event === "data") cb(Buffer.from(JSON.stringify(mockChannel))); }) },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => { if (event === "close") cb(0); })
      };

      mockSpawn.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? mockChildProcess1 : mockChildProcess2;
      });

      const result = await parseYoutubeUrl("http://youtube.com/watch?v=123");
      
      expect(mockSpawn).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        channelInfo: { _type: "playlist", entries: [mockVideo, { id: "v2" }] },
        videos: [mockVideo, { id: "v2" }], // mockVideo prepended because it wasn't in entries
        pinnedVideoId: "v1",
        specificVideoInfo: mockVideo
      });
    });
  });
});
