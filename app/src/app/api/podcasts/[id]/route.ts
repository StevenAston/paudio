import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const podcast = await prisma.podcast.findUnique({
      where: { id }
    })
    
    if (!podcast) {
      return NextResponse.json({ error: "Podcast not found" }, { status: 404 })
    }
    
    return NextResponse.json(podcast)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const allowedFields = ["namingTemplate", "customTitle", "feedUrl"]
    
    const updateData: any = {}
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field]
      }
    }

    const podcast = await prisma.podcast.update({
      where: { id },
      data: updateData
    })
    
    return NextResponse.json(podcast)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
