import { NextResponse } from "next/server";
import { fetchEntry } from "@/lib/fpl";

async function fetchEntryHistory(teamId: number) {
  const res = await fetch(`https://fantasy.premierleague.com/api/entry/${teamId}/history/`, {
    next: { revalidate: 600 }
  });
  if (!res.ok) throw new Error(`entry history ${teamId} failed: ${res.status}`);
  return res.json();
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!id) return NextResponse.json({ error: "invalid id" }, { status: 400 });

    const [entry, history] = await Promise.all([fetchEntry(id), fetchEntryHistory(id)]);
    return NextResponse.json({ ok: true, entry, history });
  } catch (err: any) {
    const message = err?.message || String(err);
    const status = /failed: (\d+)/.test(message) ? Number(message.match(/failed: (\d+)/)![1]) : 502;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
