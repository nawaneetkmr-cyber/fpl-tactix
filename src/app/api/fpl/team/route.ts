import { NextResponse } from 'next/server';

export async function GET() {
  // TODO: Read session cookie from headers and call FPL entry & picks endpoints
  return NextResponse.json({ ok: true, message: 'team placeholder' });
}
