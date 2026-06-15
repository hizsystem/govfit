"use client";

/**
 * 클라이언트 사용자 행동 추적 (관리자 분석용).
 *
 * 방문·체류시간·공고 클릭·찜하기 등 이벤트를 /api/track 으로 보내고,
 * 서버가 이를 Google 시트(events 탭)에 기록한다.
 * 페이지 이탈 중에도 유실되지 않도록 navigator.sendBeacon을 우선 사용한다.
 */

const SID_KEY = "hiz_sid";

/** 탭(세션) 단위 식별자 — sessionStorage라 탭을 닫으면 새 세션이 된다. */
function sessionId(): string {
  try {
    let id = sessionStorage.getItem(SID_KEY);
    if (!id) {
      id =
        (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `s_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      sessionStorage.setItem(SID_KEY, id);
    }
    return id;
  } catch {
    return "s_unknown";
  }
}

export function getSessionId(): string {
  return sessionId();
}

export interface TrackPayload {
  programId?: string;
  programTitle?: string;
  value?: string | number;
  industry?: string;
  region?: string;
}

/** 이벤트 1건을 서버로 전송한다. 실패는 조용히 무시(분석이 UX를 막지 않게). */
export function track(type: string, payload: TrackPayload = {}): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({
    kind: "event",
    type,
    ts: new Date().toISOString(),
    sessionId: sessionId(),
    path: window.location.pathname,
    ...payload,
  });
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/track", blob)) return;
    }
    void fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* 분석 실패는 무시 */
  }
}
