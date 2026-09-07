import { NextResponse } from "next/server"
import { processNextDownload, processNextTranscription } from "@/lib/worker"
import { prisma } from "@/lib/prisma"

let downloadWorkersCount = 0
const activeTranscribeSlots = new Set<number>()

async function spawnDownloadWorker() {
  downloadWorkersCount++
  try {
    let keepGoing = true
    while (keepGoing) {
      keepGoing = await processNextDownload()
    }
  } catch (e) {
    console.error("Download worker error:", e)
  } finally {
    downloadWorkersCount--
    spawnTranscribeWorkers()
  }
}

async function spawnTranscribeWorkers() {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: "global" } })
    const maxTranscribeThreads = settings?.transcribeThreads || 1

    for (let i = 0; i < maxTranscribeThreads; i++) {
      if (!activeTranscribeSlots.has(i)) {
        spawnSingleTranscribeWorker(i)
      }
    }
  } catch (e) {
    console.error("Error reading settings for transcribe workers:", e)
  }
}

async function spawnSingleTranscribeWorker(workerIndex: number) {
  activeTranscribeSlots.add(workerIndex)
  try {
    let keepGoing = true
    while (keepGoing) {
      keepGoing = await processNextTranscription(workerIndex)
    }
  } catch (e) {
    console.error("Transcribe worker error:", e)
  } finally {
    activeTranscribeSlots.delete(workerIndex)
  }
}

export async function POST() {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: "global" } })
    const maxThreads = settings?.downloadThreads || 1

    // Start download workers up to maxThreads
    for (let i = downloadWorkersCount; i < maxThreads; i++) {
      spawnDownloadWorker() // Fire and forget
    }

    // Start transcribe workers
    spawnTranscribeWorkers()

    return NextResponse.json({ message: "Workers started" })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
