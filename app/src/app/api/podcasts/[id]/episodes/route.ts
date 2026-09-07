import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const episodes = await prisma.episode.findMany({
      where: { podcastId: id },
      orderBy: { publishDate: "desc" },
    })
    return NextResponse.json(episodes)
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch episodes" }, { status: 500 })
  }
}
