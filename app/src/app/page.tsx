"use client"

import { useState, useEffect, useRef } from "react"
import { Play, Pause, Trash2, Plus, RefreshCw, Headphones, Mic, Settings, Settings2, Loader2, Wrench, BookOpen, X, Power } from "lucide-react"
import dynamic from "next/dynamic"

const SnipModal = dynamic(() => import('../components/SnipModal'), { ssr: false })

export default function App() {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'DOWNLOADED':
      case 'TRANSCRIBED':
      case 'COMPLETED':
        return '#432dd7'
      case 'DOWNLOADING':
      case 'TRANSCRIBING':
      case 'IN_PROGRESS':
        return '#eab308'
      case 'PENDING':
        return '#64748b'
      case 'ERROR':
        return '#ef4444'
      case 'UNPROCESSED':
      default:
        return '#0f172b'
    }
  }

  const [podcasts, setPodcasts] = useState<any[]>([])
  const [selectedPodcastId, setSelectedPodcastId] = useState<string | null>(null)
  const [episodes, setEpisodes] = useState<any[]>([])
  const [queue, setQueue] = useState<any[]>([])
  
  const [selectedEpisodes, setSelectedEpisodes] = useState<Set<string>>(new Set())
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null)
  
  const [newFeedUrl, setNewFeedUrl] = useState("")
  const [addingFeed, setAddingFeed] = useState(false)
  
  const [isTubioMode, setIsTubioMode] = useState(false)
  const [trackModalEpisode, setTrackModalEpisode] = useState<any>(null)
  const [availableTracks, setAvailableTracks] = useState<{audioFormats: any[], subtitles: any[]} | null>(null)
  const [isLoadingTracks, setIsLoadingTracks] = useState(false)
  const [selectedAudioFormat, setSelectedAudioFormat] = useState<string>("")
  const [selectedSubtitleFormat, setSelectedSubtitleFormat] = useState<string>("")

  // Snip Modal State
  const [snipEpisode, setSnipEpisode] = useState<any>(null)

  // Transcript Modal State
  const [transcriptModalEpisode, setTranscriptModalEpisode] = useState<any>(null)
  const [transcriptData, setTranscriptData] = useState<any>(null)
  const [isLoadingTranscript, setIsLoadingTranscript] = useState(false)
  // Settings modals state
  const [showGlobalSettings, setShowGlobalSettings] = useState(false)
  const [globalSettings, setGlobalSettings] = useState<any>({ 
    transcriptionEngine: "insanely-fast-whisper",
    transcriptionModel: "openai/whisper-large-v3-turbo",
    downloadThreads: 1,
    transcribeThreads: 1,
    gpuCount: 1,
    downloadsPaused: false,
    transcriptionsPaused: false,
    batchSize: 4,
    beamSize: 5,
    maxSpeakers: 4
  })
  
  const [showConfig, setShowConfig] = useState(false)
  const [namingTemplate, setNamingTemplate] = useState("")
  const [customTitle, setCustomTitle] = useState("")
  const [feedUrl, setFeedUrl] = useState("")
  const [refreshingFeed, setRefreshingFeed] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  
  const [showToolsModal, setShowToolsModal] = useState(false)
  const [toolsActiveTab, setToolsActiveTab] = useState<'benchmark' | 'logs'>('benchmark')
  
  const [benchmarkLines, setBenchmarkLines] = useState<{time: string, text: string}[]>([])
  const [isBenchmarking, setIsBenchmarking] = useState(false)
  const [benchmarkDuration, setBenchmarkDuration] = useState(60)
  const [showShutdownModal, setShowShutdownModal] = useState(false)
  const [powerOn, setPowerOn] = useState(false)

  const benchmarkScrollRef = useRef<HTMLDivElement>(null)
  const isAutoScrollEnabled = useRef(true)

  const [logLines, setLogLines] = useState<string[]>([])
  const logsScrollRef = useRef<HTMLDivElement>(null)
  const isLogsAutoScrollEnabled = useRef(true)

  useEffect(() => {
    let interval: any;
    if (showToolsModal && toolsActiveTab === 'logs') {
      const fetchLogs = async () => {
        try {
          const res = await fetch('/api/logs');
          if (res.ok) {
            const data = await res.json();
            if (data.lines) setLogLines(data.lines);
          }
        } catch (e) {}
      }
      fetchLogs();
      interval = setInterval(fetchLogs, 3000);
    }
    return () => clearInterval(interval);
  }, [showToolsModal, toolsActiveTab])

  useEffect(() => {
    if (isLogsAutoScrollEnabled.current && logsScrollRef.current) {
      logsScrollRef.current.scrollTop = logsScrollRef.current.scrollHeight
    }
  }, [logLines])

  useEffect(() => {
    if (isAutoScrollEnabled.current && benchmarkScrollRef.current) {
      benchmarkScrollRef.current.scrollTop = benchmarkScrollRef.current.scrollHeight
    }
  }, [benchmarkLines])

  // Queue resizing state
  const [queueSplitHeight, setQueueSplitHeight] = useState(50)
  const [isDraggingQueue, setIsDraggingQueue] = useState(false)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingQueue) return
      const deltaPercent = (e.movementY / window.innerHeight) * 100
      setQueueSplitHeight(prev => Math.min(Math.max(prev + deltaPercent, 10), 90))
    }
    const handleMouseUp = () => {
      setIsDraggingQueue(false)
    }
    
    if (isDraggingQueue) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    }
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingQueue])

  // Fetch initial data
  useEffect(() => {
    fetchPodcasts()
    fetchQueue()
    fetchSettings()
    const int = setInterval(fetchQueue, 3000)
    return () => clearInterval(int)
  }, [])

  useEffect(() => {
    if (selectedPodcastId) {
      fetchEpisodes(selectedPodcastId)
      const pod = podcasts.find(p => p.id === selectedPodcastId)
      if (pod) {
        setNamingTemplate(pod.namingTemplate || "{podcast_title} - {episode_number}")
        setCustomTitle(pod.customTitle || "")
        setFeedUrl(pod.feedUrl || "")
      }
      
      const int = setInterval(() => {
        fetchEpisodes(selectedPodcastId)
      }, 3000)
      return () => clearInterval(int)
    }
  }, [selectedPodcastId, podcasts])

  const fetchSettings = async () => {
    const res = await fetch("/api/settings")
    if (res.ok) setGlobalSettings(await res.json())
  }

  const saveSettings = async (updates: any) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(updates),
        headers: { "Content-Type": "application/json" }
      })
      if (res.ok) {
        setGlobalSettings(await res.json())
        setShowGlobalSettings(false)
      } else {
        const err = await res.json()
        alert(`Failed to save settings: ${err.error || res.statusText}`)
      }
    } catch (e: any) {
      alert(`Network error: ${e.message}`)
    }
  }

  const toggleQueuePause = async (type: "download" | "transcribe") => {
    const key = type === "download" ? "downloadsPaused" : "transcriptionsPaused"
    const newValue = !globalSettings[key]
    
    setGlobalSettings({ ...globalSettings, [key]: newValue })
    
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ [key]: newValue }),
        headers: { "Content-Type": "application/json" }
      })
      if (res.ok) {
        setGlobalSettings(await res.json())
      } else {
        fetchSettings()
      }
    } catch (e) {
      fetchSettings()
    }
  }

  const savePodcastConfig = async () => {
    if (!selectedPodcastId) return
    try {
      const res = await fetch(`/api/podcasts/${selectedPodcastId}`, {
        method: "PATCH",
        body: JSON.stringify({ namingTemplate, customTitle, feedUrl }),
        headers: { "Content-Type": "application/json" }
      })
      if (res.ok) {
        setShowConfig(false)
        fetchPodcasts()
      } else {
        const data = await res.json()
        alert(`Failed to save config: ${data.error || res.statusText}`)
      }
    } catch (e: any) {
      alert(`Network error: ${e.message}`)
    }
  }

  const handleRefreshFeed = async () => {
    if (!selectedPodcastId) return
    const pod = podcasts.find(p => p.id === selectedPodcastId)
    if (!pod || !pod.feedUrl) return

    setRefreshingFeed(true)
    try {
      const res = await fetch("/api/podcasts", {
        method: "POST",
        body: JSON.stringify({ feedUrl: pod.feedUrl }),
        headers: { "Content-Type": "application/json" }
      })
      if (res.ok) {
        await fetchEpisodes(selectedPodcastId)
      } else {
        alert("Failed to refresh podcast feed")
      }
    } catch (e: any) {
      alert(`Network error: ${e.message}`)
    } finally {
      setRefreshingFeed(false)
    }
  }

  const handleRenamePodcastFiles = async () => {
    if (!selectedPodcastId) return
    const pod = podcasts.find(p => p.id === selectedPodcastId)
    if (!pod) return

    if (!confirm(`Are you sure you want to forcefully rename all existing files for "${pod.title}" to match the current naming template? This could break external references.`)) {
      return
    }

    setIsRenaming(true)
    try {
      const res = await fetch(`/api/podcasts/${selectedPodcastId}/rename`, {
        method: "POST"
      })
      const data = await res.json()
      if (res.ok) {
        alert(data.message)
        await fetchEpisodes(selectedPodcastId)
      } else {
        alert(`Failed to rename files: ${data.error}`)
      }
    } catch (e: any) {
      alert(`Network error: ${e.message}`)
    } finally {
      setIsRenaming(false)
    }
  }

  const fetchPodcasts = async () => {
    const res = await fetch("/api/podcasts")
    if (res.ok) setPodcasts(await res.json())
  }

  const fetchEpisodes = async (podcastId: string) => {
    const res = await fetch(`/api/podcasts/${podcastId}/episodes`)
    if (res.ok) setEpisodes(await res.json())
  }

  const fetchQueue = async () => {
    const res = await fetch("/api/queue")
    if (res.ok) setQueue(await res.json())
  }

  const handleAddFeed = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newFeedUrl) return
    setAddingFeed(true)
    try {
      const res = await fetch("/api/podcasts", {
        method: "POST",
        body: JSON.stringify({ feedUrl: newFeedUrl }),
        headers: { "Content-Type": "application/json" }
      })
      if (res.ok) {
        const newPod = await res.json()
        setNewFeedUrl("")
        await fetchPodcasts()
        setSelectedPodcastId(newPod.id)
      } else {
        const err = await res.json()
        alert(`Error adding podcast: ${err.error || 'Unknown error'}`)
      }
    } catch (error: any) {
      alert(`Network error: ${error.message}`)
    } finally {
      setAddingFeed(false)
    }
  }

  const handleSelectIncomplete = () => {
    const incomplete = episodes.filter(ep => 
      !['DOWNLOADED', 'COMPLETED'].includes(ep.downloadStatus) || 
      !['TRANSCRIBED', 'COMPLETED'].includes(ep.transcribeStatus)
    )
    setSelectedEpisodes(new Set(incomplete.map(ep => ep.id)))
  }

  const handleInvertSelection = () => {
    const newSet = new Set<string>()
    episodes.forEach(ep => {
      if (!selectedEpisodes.has(ep.id)) {
        newSet.add(ep.id)
      }
    })
    setSelectedEpisodes(newSet)
  }

  const handleEnqueue = async (type: string = "DOWNLOAD_AND_TRANSCRIBE") => {
    if (selectedEpisodes.size === 0) return
    const ids = Array.from(selectedEpisodes)
    const res = await fetch("/api/queue", {
      method: "POST",
      body: JSON.stringify({ episodeIds: ids, type }),
      headers: { "Content-Type": "application/json" }
    })
    if (res.ok) {
      setSelectedEpisodes(new Set())
      fetchQueue()
      // Kick off worker
      fetch("/api/worker", { method: "POST" })
    }
  }

  const handleClearEpisodes = async () => {
    if (selectedEpisodes.size === 0) return
    const isMultiple = selectedEpisodes.size > 1
    const message = isMultiple 
      ? `Are you sure you want to delete all downloaded files and transcripts for ${selectedEpisodes.size} episodes?` 
      : `Are you sure you want to delete all downloaded files and transcripts for this episode?`
      
    if (!window.confirm(message)) return
    
    const ids = Array.from(selectedEpisodes)
    const res = await fetch("/api/episodes/clear", {
      method: "POST",
      body: JSON.stringify({ episodeIds: ids }),
      headers: { "Content-Type": "application/json" }
    })
    
    if (res.ok) {
      setSelectedEpisodes(new Set())
      if (selectedPodcastId) {
        fetchEpisodes(selectedPodcastId)
      }
      fetchQueue()
    } else {
      alert("Failed to clear episodes")
    }
  }

  const updateQueueJob = async (id: string, action: string) => {
    await fetch(`/api/queue/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
      headers: { "Content-Type": "application/json" }
    })
    fetchQueue()
    if (action === "resume") {
      fetch("/api/worker", { method: "POST" })
    }
  }

  const getSpeakerColor = (speaker: string) => {
    if (!speaker) return '#94a3b8'; // slate-400
    const colors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
    const hash = speaker.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
  }

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  const openTranscript = async (ep: any) => {
    if (ep.transcribeStatus !== 'COMPLETED' && ep.transcribeStatus !== 'TRANSCRIBED') return;
    setTranscriptModalEpisode(ep);
    setIsLoadingTranscript(true);
    setTranscriptData(null);
    try {
      const res = await fetch(`/api/episodes/${ep.id}/transcript`);
      if (res.ok) {
        setTranscriptData(await res.json());
      } else {
        alert("Failed to load transcript");
        setTranscriptModalEpisode(null);
      }
    } catch(e) {
      alert("Error loading transcript");
      setTranscriptModalEpisode(null);
    } finally {
      setIsLoadingTranscript(false);
    }
  }

  const openTrackModal = async (ep: any) => {
    setTrackModalEpisode(ep)
    setIsLoadingTracks(true)
    setAvailableTracks(null)
    setSelectedAudioFormat("")
    setSelectedSubtitleFormat("")
    
    try {
      const res = await fetch(`/api/youtube/tracks?videoId=${ep.youtubeVideoId}`)
      if (res.ok) {
        const data = await res.json()
        setAvailableTracks(data)
        if (data.audioFormats && data.audioFormats.length > 0) {
          setSelectedAudioFormat(data.audioFormats[0].format_id)
        }
      } else {
        alert("Failed to load tracks")
        setTrackModalEpisode(null)
      }
    } catch(e) {
      alert("Error loading tracks")
      setTrackModalEpisode(null)
    } finally {
      setIsLoadingTracks(false)
    }
  }

  const confirmTrackSelection = async () => {
    if (!trackModalEpisode) return
    
    try {
      // We need an endpoint to patch the episode formats. Wait, we don't have one! Let's do a generic PATCH or just do it in queue/enqueue
      // Wait, let's create a quick API fetch to patch it or pass formats in the enqueue request.
      // Since we just need to update it, we can hit `/api/episodes/[id]` ... wait, does that exist?
      // Let's just create a quick patch endpoint or include it when we queue.
      // It's easier to hit a PATCH to `/api/episodes/[id]`. I will need to create that route.
      
      const res = await fetch(`/api/episodes/${trackModalEpisode.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          youtubeAudioFormatId: selectedAudioFormat,
          youtubeSubtitleFormatId: selectedSubtitleFormat || null
        }),
        headers: { "Content-Type": "application/json" }
      })
      
      if (res.ok) {
        // Automatically select this episode
        const newSet = new Set(selectedEpisodes)
        newSet.add(trackModalEpisode.id)
        setSelectedEpisodes(newSet)
        
        setTrackModalEpisode(null)
        fetchEpisodes(selectedPodcastId!)
      } else {
        alert("Failed to save track selection")
      }
    } catch(e) {
      alert("Error saving track selection")
    }
  }

  const displayedPodcasts = podcasts.filter(p => isTubioMode ? p.sourceType === "YOUTUBE" : p.sourceType !== "YOUTUBE")
  
  // Sort episodes: pinned first, then by publishDate descending
  const sortedEpisodes = [...episodes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const dateA = a.publishDate ? new Date(a.publishDate).getTime() : 0
    const dateB = b.publishDate ? new Date(b.publishDate).getTime() : 0
    return dateB - dateA
  })

  return (
    <div className="flex h-screen w-full bg-slate-950 text-slate-300 font-sans relative">
      {/* Snip Modal */}
      {snipEpisode && (
        <SnipModal 
          episode={snipEpisode} 
          onClose={() => setSnipEpisode(null)} 
          onComplete={() => {
            setSnipEpisode(null)
            fetchEpisodes(selectedPodcastId!)
          }} 
        />
      )}

      {/* Transcript Modal */}
      {transcriptModalEpisode && (
        <div className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 w-[800px] max-w-full h-[80vh] shadow-xl flex flex-col relative">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-white pr-8 truncate">
                {transcriptModalEpisode.title}
              </h2>
              <button 
                onClick={() => setTranscriptModalEpisode(null)}
                className="text-slate-400 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto bg-slate-950 rounded border border-slate-800 p-4">
              {isLoadingTranscript ? (
                <div className="h-full flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                </div>
              ) : transcriptData?.segments ? (
                <div className="space-y-4">
                  {transcriptData.segments.map((seg: any, i: number) => {
                    const speakerColor = getSpeakerColor(seg.speaker);
                    return (
                      <div key={i} className="flex gap-4 hover:bg-slate-900/50 p-2 rounded transition-colors">
                        <div className="w-20 shrink-0 text-xs font-mono text-slate-500 pt-1 text-right">
                          {formatTime(seg.start)}
                        </div>
                        <div className="flex-1">
                          <span className="font-semibold text-sm mr-2" style={{ color: speakerColor }}>
                            {seg.speaker}
                          </span>
                          <span className="text-slate-300 leading-relaxed">
                            {seg.text}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-red-400 text-center mt-10">
                  Failed to load transcript data.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Track Selection Modal */}
      {trackModalEpisode && (
        <div className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 w-[600px] max-w-full h-[70vh] shadow-xl flex flex-col relative">
            <h2 className="text-xl font-bold text-white mb-4 pr-8 truncate">
              {trackModalEpisode.title}
            </h2>
            <button 
              onClick={() => setTrackModalEpisode(null)}
              className="absolute top-6 right-6 text-slate-400 hover:text-white"
            >
              <X size={24} />
            </button>
            
            <div className="flex-1 overflow-y-auto bg-slate-950 rounded border border-slate-800 p-4">
              {isLoadingTracks ? (
                <div className="h-full flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                </div>
              ) : availableTracks ? (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3">Audio Track</h3>
                    <div className="space-y-2">
                      {availableTracks.audioFormats.map((f: any) => (
                        <label key={f.format_id} className="flex items-center gap-3 p-2 hover:bg-slate-900/50 rounded cursor-pointer border border-transparent hover:border-slate-800">
                          <input 
                            type="radio" 
                            name="audio_format" 
                            value={f.format_id} 
                            checked={selectedAudioFormat === f.format_id}
                            onChange={() => setSelectedAudioFormat(f.format_id)}
                            className="text-indigo-500 focus:ring-indigo-500"
                          />
                          <span className="text-sm flex-1">
                            {f.format_note || 'Audio'} ({f.ext}, {f.acodec})
                          </span>
                          <span className="text-xs text-slate-500">
                            {f.filesize ? (f.filesize / 1024 / 1024).toFixed(1) + ' MB' : ''} {f.abr ? f.abr + 'k' : ''}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                  
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3 flex justify-between items-center">
                      Subtitle Track (Optional)
                      <button 
                        onClick={() => setSelectedSubtitleFormat("")}
                        className="text-xs text-slate-500 hover:text-slate-300"
                      >
                        Clear
                      </button>
                    </h3>
                    <div className="space-y-2">
                      {availableTracks.subtitles.length === 0 ? (
                        <div className="text-sm text-slate-500 p-2">No subtitles available</div>
                      ) : (
                        availableTracks.subtitles.map((sub: any, i: number) => (
                          <label key={i} className="flex items-center gap-3 p-2 hover:bg-slate-900/50 rounded cursor-pointer border border-transparent hover:border-slate-800">
                            <input 
                              type="radio" 
                              name="subtitle_format" 
                              value={sub.lang} 
                              checked={selectedSubtitleFormat === sub.lang}
                              onChange={() => setSelectedSubtitleFormat(sub.lang)}
                              className="text-indigo-500 focus:ring-indigo-500"
                            />
                            <span className="text-sm flex-1">
                              {sub.name}
                            </span>
                            <span className="text-xs text-slate-500">
                              {sub.ext}
                            </span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-red-400 text-center mt-10">
                  Failed to load tracks.
                </div>
              )}
            </div>
            
            <div className="flex justify-end gap-3 mt-4 shrink-0">
              <button 
                onClick={() => setTrackModalEpisode(null)} 
                className="px-4 py-2 rounded text-slate-400 hover:text-white bg-slate-800 border border-slate-700"
              >
                Cancel
              </button>
              <button 
                onClick={confirmTrackSelection} 
                disabled={isLoadingTracks || !selectedAudioFormat}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded font-medium"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shutdown Modal */}
      {showShutdownModal && (
        <div className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-sm w-full shadow-xl">
            <h2 className="text-xl font-bold text-white mb-2">Shut Down</h2>
            <p className="text-slate-400 mb-6">Are you sure you want to shut down paudio? The app will close.</p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => {
                  setShowShutdownModal(false)
                  setPowerOn(false)
                }} 
                className="px-4 py-2 rounded text-slate-400 hover:text-white bg-slate-800 border border-slate-700"
              >
                Cancel
              </button>
              <button 
                onClick={async () => {
                  try {
                    await fetch('/api/shutdown', { method: 'POST' })
                    // Wait a second then close the window or show a message
                    setTimeout(() => window.close(), 1000)
                  } catch (e) {
                    console.error('Failed to shut down', e)
                  }
                }} 
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded font-medium"
              >
                Shut Down
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Settings Modal */}
      {showGlobalSettings && (
        <div className="absolute inset-0 bg-black/60 z-50 flex items-center justify-center">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 w-96 shadow-xl">
            <h2 className="text-xl font-bold text-white mb-4">Global Settings</h2>
            <div className="mb-4">
              <label className="block text-sm text-slate-400 mb-2">Transcription Engine</label>
              <select 
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                value={globalSettings?.transcriptionEngine || "insanely-fast-whisper"}
                onChange={(e) => setGlobalSettings({ ...globalSettings, transcriptionEngine: e.target.value })}
              >
                <option value="insanely-fast-whisper">insanely-fast-whisper</option>
                <option value="whisperx">whisperx</option>
                <option value="faster-whisper">faster-whisper</option>
              </select>
            </div>
            <div className="mb-4">
              <label className="block text-sm text-slate-400 mb-2">Transcription Model</label>
              <select 
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                value={globalSettings?.transcriptionModel || "openai/whisper-large-v3-turbo"}
                onChange={(e) => setGlobalSettings({ ...globalSettings, transcriptionModel: e.target.value })}
              >
                <option value="openai/whisper-large-v3-turbo">large-v3-turbo</option>
                <option value="distil-whisper/distil-large-v3">distil-large-v3</option>
                <option value="distil-whisper/distil-large-v3.5">distil-large-v3.5</option>
              </select>
            </div>
            <div className="mb-4">
              <label className="block text-sm text-slate-400 mb-2">Download Threads</label>
              <input 
                type="number"
                min="1"
                max="10"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                value={globalSettings?.downloadThreads || 1}
                onChange={(e) => setGlobalSettings({ ...globalSettings, downloadThreads: parseInt(e.target.value) || 1 })}
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm text-slate-400 mb-1">Transcribe Threads</label>
              <input 
                type="number"
                min="1"
                max="10"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                value={globalSettings?.transcribeThreads || 1}
                onChange={(e) => setGlobalSettings({ ...globalSettings, transcribeThreads: parseInt(e.target.value) || 1 })}
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm text-slate-400 mb-1">GPU Count</label>
              <input 
                type="number"
                min="1"
                max="8"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                value={globalSettings?.gpuCount || 1}
                onChange={(e) => setGlobalSettings({ ...globalSettings, gpuCount: parseInt(e.target.value) || 1 })}
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm text-slate-400 mb-1">Batch Size</label>
              <input 
                type="number"
                min="1"
                max="128"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                value={globalSettings?.batchSize || 4}
                onChange={(e) => setGlobalSettings({ ...globalSettings, batchSize: parseInt(e.target.value) || 4 })}
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm text-slate-400 mb-1">Beam Size</label>
              <input 
                type="number"
                min="1"
                max="8"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                value={globalSettings?.beamSize || 5}
                onChange={(e) => setGlobalSettings({ ...globalSettings, beamSize: parseInt(e.target.value) || 5 })}
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm text-slate-400 mb-1">Diarization Model</label>
              <select
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                value={globalSettings?.diarizationModel || "pyannote/speaker-diarization-3.1"}
                onChange={(e) => setGlobalSettings({ ...globalSettings, diarizationModel: e.target.value })}
              >
                <option value="pyannote/speaker-diarization-3.1">pyannote/speaker-diarization-3.1</option>
                <option value="pyannote/speaker-diarization-community-1">pyannote/speaker-diarization-community-1</option>
              </select>
            </div>
            <div className="mb-4">
              <label className="block text-sm text-slate-400 mb-1">Max Speakers</label>
              <input 
                type="number"
                min="1"
                max="10"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                value={globalSettings?.maxSpeakers || 4}
                onChange={(e) => setGlobalSettings({ ...globalSettings, maxSpeakers: parseInt(e.target.value) || 4 })}
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm text-slate-400 mb-1">Diarization Embed Batch Size</label>
              <input 
                type="number"
                min="1"
                max="128"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                value={globalSettings?.diarizationEmbeddingBatchSize || 1}
                onChange={(e) => setGlobalSettings({ ...globalSettings, diarizationEmbeddingBatchSize: parseInt(e.target.value) || 1 })}
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm text-slate-400 mb-1">Diarization Segment Batch Size</label>
              <input 
                type="number"
                min="1"
                max="128"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                value={globalSettings?.diarizationSegmentationBatchSize || 1}
                onChange={(e) => setGlobalSettings({ ...globalSettings, diarizationSegmentationBatchSize: parseInt(e.target.value) || 1 })}
              />
            </div>
            <div className="mb-4 flex items-center justify-between">
              <label className="text-sm text-slate-400">Convert to Opus after transcription</label>
              <input 
                type="checkbox"
                className="rounded bg-slate-800 border-slate-700 text-indigo-500 focus:ring-indigo-500"
                checked={globalSettings?.convertToOpus || false}
                onChange={(e) => setGlobalSettings({ ...globalSettings, convertToOpus: e.target.checked })}
              />
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowGlobalSettings(false)} className="px-4 py-2 rounded text-slate-400 hover:text-white">Cancel</button>
              <button onClick={() => saveSettings(globalSettings)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded font-medium">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Podcast Config Modal */}
      {showConfig && selectedPodcastId && (
        <div className="absolute inset-0 bg-black/60 z-50 flex items-center justify-center">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 w-96 shadow-xl">
            <h2 className="text-xl font-bold text-white mb-4">Podcast Configuration</h2>
            <div className="mb-4">
              <label className="block text-sm text-slate-400 mb-2">Custom Title</label>
              <input 
                type="text"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="Leave blank to use feed title"
              />
              <p className="text-xs text-slate-500 mt-1">Override the display name of this podcast.</p>
            </div>
            <div className="mb-4">
              <label className="block text-sm text-slate-400 mb-2">RSS Feed URL</label>
              <input 
                type="text"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                value={feedUrl}
                onChange={(e) => setFeedUrl(e.target.value)}
                placeholder="https://example.com/feed.xml"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm text-slate-400 mb-2">Naming Template</label>
              <input 
                type="text"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500 font-mono text-sm"
                value={namingTemplate}
                onChange={(e) => setNamingTemplate(e.target.value)}
                placeholder="{title} - {YYYY}-{MM}-{DD}"
              />
              <p className="text-xs text-slate-500 mt-1">Available tags: {'{title}, {name}, {number}, {YYYY}, {MM}, {DD}'}</p>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowConfig(false)} className="px-4 py-2 rounded text-slate-400 hover:text-white">Cancel</button>
              <button onClick={savePodcastConfig} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded font-medium">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Tools Modal */}
      {showToolsModal && (
        <div className="absolute inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 w-[1000px] max-w-full min-h-[400px] max-h-[95vh] shadow-xl flex flex-col resize overflow-hidden relative">
            <h2 className="text-xl font-bold text-white mb-4">Tools</h2>
            
            <div className="mb-4 flex items-center gap-3 border-b border-slate-800 pb-4">
              <div className="flex bg-slate-800 p-1 rounded mr-2">
                <button
                  onClick={() => setToolsActiveTab('logs')}
                  className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${toolsActiveTab === 'logs' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  Logs
                </button>
                <button
                  onClick={() => setToolsActiveTab('benchmark')}
                  className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${toolsActiveTab === 'benchmark' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  Benchmark
                </button>
              </div>

              {toolsActiveTab === 'benchmark' && (
                <>
                  <select 
                    className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                    value={benchmarkDuration}
                    onChange={(e) => setBenchmarkDuration(Number(e.target.value))}
                  >
                    <option value={15}>15 Minutes</option>
                    <option value={30}>30 Minutes</option>
                    <option value={45}>45 Minutes</option>
                    <option value={60}>60 Minutes</option>
                    <option value={90}>90 Minutes</option>
                    <option value={120}>120 Minutes</option>
                    <option value={180}>180 Minutes</option>
                    <option value={240}>240 Minutes</option>
                  </select>
                  <button 
                    onClick={async () => {
                      setIsBenchmarking(true)
                      setBenchmarkLines([{
                        time: new Date().toISOString().substring(11, 22),
                        text: "Running benchmark..."
                      }])
                      
                      try {
                        const res = await fetch("/api/benchmark", {
                          method: "POST",
                          body: JSON.stringify({ duration: benchmarkDuration }),
                          headers: { "Content-Type": "application/json" }
                        })
                        
                        if (!res.body) throw new Error("No response body")
                        
                        const reader = res.body.getReader()
                        const decoder = new TextDecoder()
                        
                        let buffer = ""
                        while (true) {
                          const { value, done } = await reader.read()
                          if (done) {
                            if (buffer) {
                              const now = new Date()
                              const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${Math.floor(now.getMilliseconds()/10).toString().padStart(2, '0')}`
                              setBenchmarkLines(prev => [...prev, { time: timeStr, text: buffer }])
                            }
                            break
                          }
                          
                          buffer += decoder.decode(value, { stream: true })
                          const lines = buffer.split('\n')
                          buffer = lines.pop() || ""
                          
                          if (lines.length > 0) {
                            const now = new Date()
                            const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${Math.floor(now.getMilliseconds()/10).toString().padStart(2, '0')}`
                            setBenchmarkLines(prev => [...prev, ...lines.map(l => ({ time: timeStr, text: l }))])
                          }
                        }
                      } catch (e: any) {
                        const now = new Date()
                        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${Math.floor(now.getMilliseconds()/10).toString().padStart(2, '0')}`
                        setBenchmarkLines(prev => [...prev, { time: timeStr, text: `Error: ${e.message}` }])
                      } finally {
                        setIsBenchmarking(false)
                      }
                    }}
                    disabled={isBenchmarking}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded font-medium flex items-center gap-2"
                  >
                    {isBenchmarking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    Run Benchmark
                  </button>
                </>
              )}
            </div>

            {toolsActiveTab === 'benchmark' ? (
              <div 
                ref={benchmarkScrollRef}
                onScroll={(e) => {
                  const target = e.target as HTMLDivElement
                  isAutoScrollEnabled.current = target.scrollHeight - target.scrollTop - target.clientHeight < 10
                }}
                className="flex-1 bg-black rounded p-3 font-mono text-sm min-h-[12rem] overflow-y-auto mb-4"
              >
                {benchmarkLines.length === 0 ? (
                  <div className="text-green-400">Ready.</div>
                ) : (
                  <table className="w-full text-left">
                    <tbody>
                      {benchmarkLines.map((line, i) => (
                        <tr key={i} className="align-top hover:bg-white/5 transition-colors">
                          <td className="w-[100px] text-slate-500 pr-4 select-none border-r border-slate-800/50">{line.time}</td>
                          <td className="text-green-400 pl-4 whitespace-pre-wrap break-all">{line.text}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : (
              <div 
                ref={logsScrollRef}
                onScroll={(e) => {
                  const target = e.target as HTMLDivElement
                  isLogsAutoScrollEnabled.current = target.scrollHeight - target.scrollTop - target.clientHeight < 10
                }}
                className="flex-1 bg-black rounded p-3 font-mono text-sm min-h-[12rem] overflow-y-auto mb-4"
              >
                {logLines.length === 0 ? (
                  <div className="text-slate-500 flex justify-center items-center h-full gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading logs...
                  </div>
                ) : (
                  <div className="text-slate-300 whitespace-pre-wrap break-all leading-relaxed">
                    {logLines.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-end gap-3 mt-auto">
              <button onClick={() => setShowToolsModal(false)} className="px-4 py-2 rounded text-slate-400 hover:text-white bg-slate-800 border border-slate-700">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar - Podcasts */}
      <div className="w-80 bg-slate-900 border-r border-slate-800 flex flex-col relative">
        <div className="p-4 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              {isTubioMode ? (
                <Play className="w-6 h-6 text-red-500" fill="currentColor" />
              ) : (
                <Headphones className="w-6 h-6 text-indigo-400" />
              )}
              {isTubioMode ? "Tubio" : "paudio"}
              <button 
                onClick={() => {
                  setIsTubioMode(!isTubioMode)
                  setSelectedPodcastId(null)
                  setEpisodes([])
                  setSelectedEpisodes(new Set())
                }}
                className="ml-2 text-slate-500 hover:text-slate-300 transition-colors"
                title={`Switch to ${isTubioMode ? 'paudio' : 'Tubio'}`}
              >
                ↻
              </button>
            </h1>
            <button
              onClick={() => {
                setPowerOn(true)
                setShowShutdownModal(true)
              }}
              className={`p-1.5 rounded transition-colors ${powerOn ? 'text-red-500' : 'text-slate-600 hover:text-slate-400'}`}
              title="Shut down"
            >
              <Power className="w-5 h-5" />
            </button>
          </div>
          <form onSubmit={handleAddFeed} className="mt-4 flex gap-2">
            <input 
              type="url" 
              placeholder={isTubioMode ? "YouTube URL..." : "RSS Feed URL..."}
              value={newFeedUrl}
              onChange={e => setNewFeedUrl(e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
            <button 
              type="submit" 
              disabled={addingFeed}
              className={`${isTubioMode ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'} text-white p-2 rounded disabled:opacity-50`}
            >
              {addingFeed ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </button>
          </form>
        </div>
        
        <div className="flex-1 overflow-y-auto mb-16">
          {displayedPodcasts.map(pod => (
            <button
              key={pod.id}
              onClick={() => setSelectedPodcastId(pod.id)}
              className={`w-full text-left p-4 border-b border-slate-800/50 hover:bg-slate-800/50 transition-colors flex items-center gap-3 ${selectedPodcastId === pod.id ? (isTubioMode ? 'bg-slate-800 border-l-4 border-l-red-500' : 'bg-slate-800 border-l-4 border-l-indigo-500') : ''}`}
            >
              {pod.coverImageUrl ? (
                <img src={pod.coverImageUrl} alt="" className="w-10 h-10 rounded bg-slate-800 object-cover" />
              ) : (
                <div className="w-10 h-10 rounded bg-slate-800 flex items-center justify-center">
                  {isTubioMode ? <Play className="w-5 h-5 text-slate-500" /> : <Mic className="w-5 h-5 text-slate-500" />}
                </div>
              )}
              <div className="flex-1 overflow-hidden">
                <div className="font-medium text-white truncate">{pod.customTitle || pod.title}</div>
                <div className="text-xs text-slate-500">{pod._count?.episodes || 0} {isTubioMode ? 'videos' : 'episodes'}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Global Settings & Tools */}
        <div className="absolute bottom-0 left-0 right-0 border-t border-slate-800 bg-slate-900 flex">
          <button 
            onClick={() => setShowGlobalSettings(true)}
            className="flex-1 p-4 flex items-center justify-center gap-2 text-slate-400 hover:bg-slate-800/50 hover:text-white transition-colors border-r border-slate-800"
          >
            <Settings className="w-5 h-5" />
            <span className="text-sm font-medium">Settings</span>
          </button>
          <button 
            onClick={() => setShowToolsModal(true)}
            className="flex-1 p-4 flex items-center justify-center gap-2 text-slate-400 hover:bg-slate-800/50 hover:text-white transition-colors"
          >
            <Wrench className="w-5 h-5" />
            <span className="text-sm font-medium">Tools</span>
          </button>
        </div>
      </div>

      {/* Main Area - Episodes */}
      <div className="flex-1 flex flex-col">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
          <h2 className="text-lg font-semibold text-white">Episodes</h2>
          <div className="flex items-center gap-3">
            {selectedPodcastId && (
              <>
                <button 
                  onClick={handleRefreshFeed}
                  disabled={refreshingFeed}
                  className="p-2 bg-slate-800 text-slate-300 rounded hover:bg-slate-700 hover:text-white transition-colors border border-slate-700"
                  title="Refresh Feed"
                >
                  <RefreshCw size={20} className={refreshingFeed ? "animate-spin text-indigo-400" : ""} />
                </button>
                <button 
                  onClick={handleRenamePodcastFiles}
                  disabled={isRenaming}
                  className="p-2 bg-slate-800 text-slate-300 rounded hover:bg-slate-700 hover:text-white transition-colors border border-slate-700"
                  title="Force Rename Files"
                >
                  {isRenaming ? <Loader2 size={20} className="animate-spin" /> : "🛠️"}
                </button>
                <button 
                  onClick={() => setShowConfig(true)}
                  className="p-2 bg-slate-800 text-slate-300 rounded hover:bg-slate-700 hover:text-white transition-colors border border-slate-700"
                  title="Configuration"
                >
                  <Settings2 size={20} />
                </button>
                <div className="flex bg-indigo-600 rounded shadow-sm">
                  <button 
                    onClick={() => handleEnqueue("DOWNLOAD_AND_TRANSCRIBE")}
                    disabled={selectedEpisodes.size === 0}
                    className="hover:bg-indigo-700 text-white px-3 py-1.5 rounded-l font-medium transition-colors disabled:opacity-50 text-sm flex items-center gap-1.5"
                    title="Download & Transcribe"
                  >
                    <Play size={14} fill="currentColor" /> All
                  </button>
                  <div className="w-px bg-indigo-800 shrink-0"></div>
                  <button 
                    onClick={() => handleEnqueue("DOWNLOAD_ONLY")}
                    disabled={selectedEpisodes.size === 0}
                    className="hover:bg-indigo-700 text-white px-3 py-1.5 font-medium transition-colors disabled:opacity-50 text-sm"
                    title="Download Only"
                  >
                    DL
                  </button>
                  <div className="w-px bg-indigo-800 shrink-0"></div>
                  <button 
                    onClick={() => handleEnqueue("TRANSCRIBE_ONLY")}
                    disabled={selectedEpisodes.size === 0}
                    className="hover:bg-indigo-700 text-white px-3 py-1.5 rounded-r font-medium transition-colors disabled:opacity-50 text-sm flex items-center"
                    title="Transcribe Only"
                  >
                    <Mic size={14} />
                  </button>
                </div>
                <button
                  onClick={handleClearEpisodes}
                  disabled={selectedEpisodes.size === 0}
                  className="p-1.5 bg-red-900/50 text-red-400 rounded hover:bg-red-900 hover:text-white transition-colors border border-red-900/50 disabled:opacity-50"
                  title="Clear Files & Data"
                >
                  <Trash2 size={20} />
                </button>
              </>
            )}
            <button 
              onClick={handleSelectIncomplete}
              className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded text-sm font-medium transition-colors border border-slate-700"
              title="Select incomplete episodes"
            >
              Select Incomplete
            </button>
            <button 
              onClick={handleInvertSelection}
              className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded text-sm font-medium transition-colors border border-slate-700"
              title="Invert current selection"
            >
              Invert
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4">
          {!selectedPodcastId ? (
            <div className="h-full flex items-center justify-center text-slate-500">
              Select a podcast to view episodes
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-sm">
                  <th className="p-3 w-12 text-center">
                    <input 
                      type="checkbox" 
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedEpisodes(new Set(episodes.map(ep => ep.id)))
                        } else {
                          setSelectedEpisodes(new Set())
                        }
                      }}
                      className="rounded bg-slate-800 border-slate-700 text-indigo-500 focus:ring-indigo-500"
                    />
                  </th>
                  <th className="p-3 font-medium w-24">Status</th>
                  <th className="p-3 font-medium">Title</th>
                  <th className="p-3 font-medium w-24 text-right">Length</th>
                  <th className="p-3 font-medium w-48">Publish Date</th>
                </tr>
              </thead>
              <tbody>
                {sortedEpisodes.map((ep, idx) => (
                  <tr key={ep.id} className={`border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors ${ep.pinned ? 'bg-indigo-950/20' : ''}`}>
                    <td className="p-3 text-center">
                      <input 
                        type="checkbox" 
                        checked={selectedEpisodes.has(ep.id)}
                        onChange={(e) => {
                          const newSet = new Set(selectedEpisodes)
                          const isShift = (e.nativeEvent as any).shiftKey
                          const isChecking = e.target.checked
                          
                          if (isShift && lastSelectedIndex !== null) {
                            const start = Math.min(lastSelectedIndex, idx)
                            const end = Math.max(lastSelectedIndex, idx)
                            for (let i = start; i <= end; i++) {
                              if (isChecking) newSet.add(sortedEpisodes[i].id)
                              else newSet.delete(sortedEpisodes[i].id)
                            }
                          } else {
                            if (isChecking) newSet.add(ep.id)
                            else newSet.delete(ep.id)
                            setLastSelectedIndex(idx)
                          }
                          
                          setSelectedEpisodes(newSet)
                        }}
                        className="rounded bg-slate-800 border-slate-700 text-indigo-500 focus:ring-indigo-500"
                      />
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex gap-1.5">
                          <div 
                            title={`Download: ${ep.downloadStatus}`}
                            className="w-3 h-3 rounded-full shrink-0 border border-slate-700/50"
                            style={{ backgroundColor: getStatusColor(ep.downloadStatus) }}
                          />
                          <div 
                            title={`Transcribe: ${ep.transcribeStatus}`}
                            className="w-3 h-3 rounded-full shrink-0 border border-slate-700/50"
                            style={{ backgroundColor: getStatusColor(ep.transcribeStatus) }}
                          />
                        </div>
                        {(ep.transcribeStatus === 'COMPLETED' || ep.transcribeStatus === 'TRANSCRIBED') && (
                          <button
                            onClick={() => openTranscript(ep)}
                            className="text-slate-400 hover:text-indigo-400 transition-colors"
                            title="View Transcript"
                          >
                            <BookOpen size={16} />
                          </button>
                        )}
                        {['DOWNLOADED', 'COMPLETED', 'TRANSCRIBED'].includes(ep.downloadStatus) && (
                          <button
                            onClick={() => setSnipEpisode(ep)}
                            className="text-slate-400 hover:text-indigo-400 transition-colors ml-1 text-sm"
                            title="Snip Audio"
                          >
                            ✂️
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-white">
                      {ep.episodeNumber && <span className="text-slate-500 mr-2">Ep {ep.episodeNumber}</span>}
                      {ep.pinned && <span className="text-amber-500 mr-2 text-xs font-bold" title="Pinned specifically requested video">★</span>}
                      {isTubioMode ? (
                        <button 
                          onClick={() => openTrackModal(ep)}
                          className="text-left hover:text-red-400 transition-colors"
                        >
                          {ep.title}
                        </button>
                      ) : (
                        <span>{ep.title}</span>
                      )}
                    </td>
                    <td className="p-3 text-slate-400 text-sm text-right">
                      {ep.duration ? (
                        ep.duration >= 3600 
                          ? `${Math.floor(ep.duration / 3600)}h ${Math.floor((ep.duration % 3600) / 60)}m`
                          : `${Math.floor(ep.duration / 60)}m`
                      ) : '-'}
                    </td>
                    <td className="p-3 text-slate-400 text-sm">
                      {ep.publishDate ? new Date(ep.publishDate).toLocaleDateString() : 'Unknown'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Right Sidebar - Queue */}
      <div 
        className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col relative"
        style={{ cursor: isDraggingQueue ? 'row-resize' : 'default', userSelect: isDraggingQueue ? 'none' : 'auto' }}
      >
        <div className="p-4 border-b border-slate-800 shrink-0">
          <h2 className="text-lg font-semibold text-white">Queue</h2>
        </div>
        
        {(() => {
          const displayedQueue = queue
          const transcribeQueue = displayedQueue.filter(job => job.progress >= 50 && job.status !== "COMPLETED")
          const downloadQueue = displayedQueue.filter(job => job.progress < 50 && job.status !== "COMPLETED")
          
          const renderJob = (job: any) => (
            <div key={job.id} className="bg-slate-800 rounded-lg p-3 border border-slate-700 relative overflow-hidden mb-3 shrink-0">
              {/* Progress bar background */}
              {job.status === "IN_PROGRESS" && (() => {
                let colorClass = "bg-rose-500"
                let widthPercent = 0
                
                if (job.progress < 25) {
                  colorClass = "bg-rose-500"
                  widthPercent = job.progress * 4
                } else if (job.progress < 50) {
                  colorClass = "bg-violet-500"
                  widthPercent = (job.progress - 25) * 4
                } else if (job.progress < 75) {
                  colorClass = "bg-emerald-500"
                  widthPercent = (job.progress - 50) * 4
                } else {
                  colorClass = "bg-indigo-500"
                  widthPercent = (job.progress - 75) * 4
                }

                return (
                  <div 
                    className={`absolute bottom-0 left-0 h-1 transition-all duration-500 ${colorClass}`}
                    style={{ width: `${Math.min(100, Math.max(0, widthPercent))}%` }}
                  />
                )
              })()}
              
              {job.status === "COMPRESSING" && (
                <div 
                  className="absolute bottom-0 left-0 h-1 bg-yellow-500 transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }}
                />
              )}
              
              <div className="flex justify-between items-start mb-2">
                <div className={`text-xs font-medium ${job.status === 'ERROR' ? 'text-red-400' : 'text-indigo-400'}`}>
                  {job.status === "IN_PROGRESS" ? (
                    job.progress < 25 ? "DOWNLOADING" :
                    job.progress < 50 ? "CONVERTING" :
                    job.progress < 75 ? "TRANSCRIBING" :
                    "DETECTING SPEAKERS"
                  ) : job.status === "COMPRESSING" ? (
                    "CONVERTING TO OPUS"
                  ) : job.status}
                </div>
                <div className="flex gap-1">
                  {job.status === "PAUSED" ? (
                    <button onClick={() => updateQueueJob(job.id, "resume")} className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white">
                      <Play className="w-3 h-3" />
                    </button>
                  ) : (
                    <button onClick={() => updateQueueJob(job.id, "pause")} className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white">
                      <Pause className="w-3 h-3" />
                    </button>
                  )}
                  <button onClick={() => updateQueueJob(job.id, "delete")} className="p-1 hover:bg-red-900/50 rounded text-slate-400 hover:text-red-400">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              
              <div className="text-xs text-slate-400 mb-1 line-clamp-1">
                {job.episode?.podcast?.title}
              </div>
              <div className="text-sm font-medium text-white line-clamp-2 leading-tight mb-1">
                {job.episode.title}
              </div>
              
              {job.status === 'ERROR' && job.errorMessage && (
                <div className="text-xs text-red-400 mt-2 bg-red-950/50 p-2 rounded border border-red-900/50 break-words whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {job.errorMessage}
                </div>
              )}
            </div>
          )

          return (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Transcription Half */}
              <div className="flex flex-col border-b border-slate-800" style={{ height: `${queueSplitHeight}%` }}>
                <div className="p-3 bg-slate-900/80 sticky top-0 z-10 shrink-0 flex justify-between items-center">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Transcription</h3>
                  <button 
                    onClick={() => toggleQueuePause("transcribe")}
                    className={`p-1 rounded text-slate-400 hover:text-white ${globalSettings?.transcriptionsPaused ? 'bg-red-900/30 text-red-400 hover:text-red-300' : 'hover:bg-slate-700'}`}
                    title={globalSettings?.transcriptionsPaused ? "Resume All Transcriptions" : "Pause All Transcriptions"}
                  >
                    {globalSettings?.transcriptionsPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-3 pt-0">
                  {transcribeQueue.length > 0 ? transcribeQueue.map(renderJob) : (
                    <div className="text-center text-slate-600 text-sm py-4">No active transcriptions</div>
                  )}
                </div>
              </div>

              {/* Draggable Divider */}
              <div 
                className="h-2 bg-slate-800/50 hover:bg-indigo-500/50 cursor-row-resize shrink-0 transition-colors"
                onMouseDown={() => setIsDraggingQueue(true)}
              />

              {/* Download Half */}
              <div className="flex flex-col" style={{ height: `${100 - queueSplitHeight}%` }}>
                <div className="p-3 bg-slate-900/80 sticky top-0 z-10 shrink-0 flex justify-between items-center">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Download</h3>
                  <button 
                    onClick={() => toggleQueuePause("download")}
                    className={`p-1 rounded text-slate-400 hover:text-white ${globalSettings?.downloadsPaused ? 'bg-red-900/30 text-red-400 hover:text-red-300' : 'hover:bg-slate-700'}`}
                    title={globalSettings?.downloadsPaused ? "Resume All Downloads" : "Pause All Downloads"}
                  >
                    {globalSettings?.downloadsPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-3 pt-0">
                  {downloadQueue.length > 0 ? downloadQueue.map(renderJob) : (
                    <div className="text-center text-slate-600 text-sm py-4">No active downloads</div>
                  )}
                </div>
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
