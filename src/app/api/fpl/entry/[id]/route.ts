import { NextResponse } from "next/server";
import { fetchEntry, fetchEntryHistory } from "@/lib/fpl";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!id) return NextResponse.json({ error: "invalid id" }, { status: 400 });

    const [entry, history] = await Promise.all([
      fetchEntry(id),
      fetchEntryHistory(id),
    ]);
    return NextResponse.json({ ok: true, entry, history });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const match = message.match(/failed: (\d+)/);
    const status = match ? Number(match[1]) : 502;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
