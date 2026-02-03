import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const headers = {
      'user-agent': 'FPL Tactix/1.0 (+https://example.local)'
    };

    // Fetch bootstrap and fixtures in parallel
    const [bootstrapRes, fixturesRes] = await Promise.all([
      fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
        headers,
        next: { revalidate: 3600 }
      }),
      fetch('https://fantasy.premierleague.com/api/fixtures/', {
        headers,
        next: { revalidate: 3600 }
      })
    ]);

    if (!bootstrapRes.ok) {
      return NextResponse.json({ ok: false, status: bootstrapRes.status }, { status: bootstrapRes.status });
    }

    const bootstrap = await bootstrapRes.json();

    // Parse fixtures (may fail, that's ok - we'll return empty array)
    let fixtures: unknown[] = [];
    if (fixturesRes.ok) {
      fixtures = await fixturesRes.json();
    }

    // Detect current gameweek from events
    const events = bootstrap.events || [];
    let currentGW = 1;
    const currentEvent = events.find((e: { is_current: boolean }) => e.is_current);
    const nextEvent = events.find((e: { is_next: boolean }) => e.is_next);
    if (currentEvent && !currentEvent.finished) {
      currentGW = currentEvent.id;
    } else if (nextEvent) {
      currentGW = nextEvent.id;
    } else if (currentEvent) {
      currentGW = currentEvent.id;
    } else {
      // Fallback: use next event if there's no current, otherwise highest finished.
      const finishedEvents = events.filter((e: { finished: boolean }) => e.finished);
      if (finishedEvents.length > 0) {
        currentGW = Math.max(...finishedEvents.map((e: { id: number }) => e.id));
      }
    }

    // Return flattened structure for easier consumption
    return NextResponse.json({
      ok: true,
      elements: bootstrap.elements || [],
      teams: bootstrap.teams || [],
      events: bootstrap.events || [],
      element_types: bootstrap.element_types || [],
      fixtures,
      currentGW,
    });
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
