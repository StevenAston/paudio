import { PrismaClient } from "../generated/client/client"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"

// Force a completely fresh instance every time to bypass Next.js memory caching
// during development, which was causing the 'Unknown field episode' error
const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL!,
})

export const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
})
