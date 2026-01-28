import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
      headers: {
        'user-agent': 'FPL Tactix/1.0 (+https://example.local)'
      },
      // Next.js fetch caching: revalidate periodically
      next: { revalidate: 3600 }
    });
    if (!res.ok) return NextResponse.json({ ok: false, status: res.status }, { status: res.status });
    const data = await res.json();
    return NextResponse.json({ ok: true, data });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
