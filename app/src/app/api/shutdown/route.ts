import { NextResponse } from 'next/server';

export async function POST() {
  // Give the response a tiny bit of time to return before killing the process
  setTimeout(() => {
    process.exit(0);
  }, 1000);
  
  return NextResponse.json({ success: true, message: 'Shutting down server...' });
}
