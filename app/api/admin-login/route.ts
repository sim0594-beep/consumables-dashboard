import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const inputPassword = String(body?.password ?? "");
    const adminPassword = process.env.ADMIN_PASSWORD || "1234";

    if (inputPassword === adminPassword) {
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false }, { status: 401 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
