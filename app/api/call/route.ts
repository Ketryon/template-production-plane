import { NextRequest, NextResponse } from "next/server";
import { callVendor, ReadOnlyError } from "@/lib/proxy";
import { getPlaneUser } from "@/lib/auth";

/**
 * POST /api/call — one the vendor read.
 *
 * No method parameter: every call is a GET. There is no way to express a write
 * through this API, which is the point rather than an omission.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    sourceId?: string;
    path?: string;
  } | null;

  if (!body?.sourceId) {
    return NextResponse.json({ error: "sourceId is required" }, { status: 400 });
  }
  if (!body.path?.trim()) {
    return NextResponse.json({ error: "path is required, e.g. /3/customers" }, { status: 400 });
  }

  try {
    // Middleware has established there IS a session; this resolves whose, so the
    // call log can answer "by whom".
    const user = await getPlaneUser();
    return NextResponse.json(
      await callVendor({
        sourceId: body.sourceId,
        path: body.path,
        actor: user?.email ?? user?.id ?? null,
      }),
    );
  } catch (error) {
    // 403 rather than 423: this is not a lock that can be opened.
    if (error instanceof ReadOnlyError) {
      return NextResponse.json({ error: error.message, refused: true }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed" },
      { status: 500 },
    );
  }
}
