"use client"

import React, { useState, useEffect, useRef } from 'react'
import { X, Scissors, Loader2, Play, Pause, Plus, Trash2 } from 'lucide-react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'

export default function SnipModal({ episode, onClose, onComplete }: { episode: any, onClose: () => void, onComplete: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [wavesurfer, setWavesurfer] = useState<WaveSurfer | null>(null)
  const [wsRegions, setWsRegions] = useState<any>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [segments, setSegments] = useState<{ id: string, start: number, end: number }[]>([])
  const [isProcessing, setIsProcessing] = useState(false)

  useEffect(() => {
    if (!containerRef.current) return

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#4f46e5',
      progressColor: '#818cf8',
      url: `/api/episodes/${episode.id}/audio`,
      height: 100,
      normalize: true,
      minPxPerSec: 10,
    })

    const regions = ws.registerPlugin(RegionsPlugin.create())

    ws.on('ready', () => {
      setWavesurfer(ws)
      setWsRegions(regions)
    })

    ws.on('play', () => setIsPlaying(true))
    ws.on('pause', () => setIsPlaying(false))

    regions.on('region-created', (region) => {
      setSegments(prev => {
        const newSegments = [...prev]
        if (!newSegments.find(s => s.id === region.id)) {
          newSegments.push({ id: region.id, start: region.start, end: region.end })
        }
        return newSegments
      })
    })

    regions.on('region-updated', (region) => {
      setSegments(prev => prev.map(s => s.id === region.id ? { ...s, start: region.start, end: region.end } : s))
    })

    return () => {
      ws.destroy()
    }
  }, [episode.id])

  const addRegion = () => {
    if (!wavesurfer || !wsRegions) return
    const time = wavesurfer.getCurrentTime()
    wsRegions.addRegion({
      start: time,
      end: time + 10,
      color: 'rgba(239, 68, 68, 0.4)' // Red overlay for remove
    })
  }

  const deleteSegment = (id: string) => {
    if (!wsRegions) return
    const region = wsRegions.getRegions().find((r: any) => r.id === id)
    if (region) region.remove()
    setSegments(prev => prev.filter(s => s.id !== id))
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const handleApply = async () => {
    if (segments.length === 0) {
      alert("No segments to remove.")
      return
    }
    setIsProcessing(true)
    try {
      const payload = segments.map(s => ({ start: s.start, end: s.end }))
      const res = await fetch(`/api/episodes/${episode.id}/snip`, {
        method: "POST",
        body: JSON.stringify({ segments: payload }),
        headers: { "Content-Type": "application/json" }
      })
      if (res.ok) {
        onComplete()
      } else {
        const text = await res.text()
        alert(`Failed to snip audio: ${text}`)
      }
    } catch (e: any) {
      alert(`Network error: ${e.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 w-[900px] max-w-full shadow-xl flex flex-col relative">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white pr-8 truncate">
            ✂️ Snip Ads: {episode.title}
          </h2>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white"
          >
            <X size={24} />
          </button>
        </div>
        
        <div className="bg-slate-950 border border-slate-800 rounded p-4 mb-4">
          <div ref={containerRef} className="w-full"></div>
          
          <div className="flex items-center gap-4 mt-4">
            <button 
              onClick={() => wavesurfer?.playPause()}
              className="bg-indigo-600 hover:bg-indigo-700 text-white p-2 rounded-full"
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button 
              onClick={addRegion}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 text-sm"
            >
              <Plus size={16} /> Add Snip Segment
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-[150px] max-h-[300px] overflow-y-auto bg-slate-950 border border-slate-800 rounded p-4 mb-4">
          <h3 className="text-slate-400 text-sm font-semibold mb-3">Segments to Remove</h3>
          {segments.length === 0 ? (
            <p className="text-slate-500 text-sm">Add segments on the waveform to remove them.</p>
          ) : (
            <div className="space-y-2">
              {segments.map((seg, i) => (
                <div key={seg.id} className="flex items-center gap-4 bg-slate-900 p-2 rounded border border-slate-800">
                  <span className="text-slate-400 text-sm font-mono w-8">#{i + 1}</span>
                  <div className="flex-1 text-sm text-slate-300">
                    {formatTime(seg.start)} - {formatTime(seg.end)}
                  </div>
                  <button 
                    onClick={() => deleteSegment(seg.id)}
                    className="text-red-400 hover:text-red-300 p-1"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 shrink-0">
          <button 
            onClick={onClose} 
            className="px-4 py-2 rounded text-slate-400 hover:text-white bg-slate-800 border border-slate-700"
          >
            Cancel
          </button>
          <button 
            onClick={handleApply} 
            disabled={isProcessing || segments.length === 0}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-4 py-2 rounded font-medium"
          >
            {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Scissors size={16} />}
            Apply Cuts
          </button>
        </div>
      </div>
    </div>
  )
}
