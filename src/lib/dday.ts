// 마감일(D-day) 계산 공유 헬퍼 — 추천 결과와 전체 공고 둘러보기에서 함께 사용.

export interface Dday {
  label: string;
  tone: "urgent" | "soon" | "normal" | "closed";
}

/**
 * 마감일(YYYY-MM-DD)과 오늘의 일수 차 (사용자 로컬 날짜 기준).
 * 파싱 불가 시 null. 양수면 마감 전, 0이면 오늘 마감, 음수면 마감 지남.
 */
export function ddayDiff(endDate: string): number | null {
  const end = new Date(`${endDate}T23:59:59`);
  if (Number.isNaN(end.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/** 마감일 → 뱃지 표시용 라벨/톤. 파싱 불가 시 null. */
export function computeDday(endDate: string): Dday | null {
  const diff = ddayDiff(endDate);
  if (diff === null) return null;
  if (diff < 0) return { label: "마감", tone: "closed" };
  if (diff === 0) return { label: "오늘 마감", tone: "urgent" };
  if (diff <= 7) return { label: `D-${diff}`, tone: "urgent" };
  if (diff <= 14) return { label: `D-${diff}`, tone: "soon" };
  return { label: `D-${diff}`, tone: "normal" };
}
