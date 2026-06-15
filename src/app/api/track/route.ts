import { after } from "next/server";

// 클라이언트 행동 이벤트 수집 → Google 시트(events 탭)로 전달.
// sendBeacon으로 들어오므로 즉시 204를 주고, 전달은 응답 후 처리한다.

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 204 });
  }
  after(() => forward(body));
  return new Response(null, { status: 204 });
}

/** 들어온 이벤트를 Google Apps Script 웹훅으로 전달 (필드는 화이트리스트로 제한). */
async function forward(body: unknown): Promise<void> {
  const url = process.env.GSHEET_WEBHOOK_URL;
  if (!url || typeof body !== "object" || body === null) return;

  const e = body as Record<string, unknown>;
  const s = (v: unknown, n: number) => String(v ?? "").slice(0, n);
  const row = {
    kind: "event",
    ts: typeof e.ts === "string" ? e.ts : new Date().toISOString(),
    sessionId: s(e.sessionId, 64),
    type: s(e.type, 40),
    programId: s(e.programId, 120),
    programTitle: s(e.programTitle, 200),
    value: s(e.value, 120),
    industry: s(e.industry, 60),
    region: s(e.region, 40),
    path: s(e.path, 120),
  };

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.warn("[track] 이벤트 기록 실패:", err);
  }
}
