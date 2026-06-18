import { NextResponse } from "next/server";
import { loadPrograms } from "@/lib/data/loader";
import { loadCumulativeTotal } from "@/lib/data/cumulative";

// 여러 공공 OpenAPI를 병렬 집계하므로 Vercel 기본 함수 타임아웃보다 여유를 둔다.
// loadPrograms는 1시간 캐시되어 보통 즉시 응답하지만, 콜드 스타트(캐시 미존재) 시
// 집계가 길어 기본 타임아웃에 걸리면 '연동 개수' 배지가 안 뜬다. (recommend와 동일)
export const maxDuration = 30;

interface StatsResponse {
  /** 지금 신청 가능한(모집중) 지원사업 수 — 중복 제거 후 */
  total: number;
  /** 누적 연동 공고 수 (마감 포함, 연동 소스 보유 총량) */
  cumulative: number;
  /** 데이터 출처(소스)별 개수 */
  bySource: Record<string, number>;
  /** 연동 소스 수 */
  sourceCount: number;
}

/**
 * GET /api/stats
 *
 * 두 지표를 반환한다:
 *  - total: 지금 신청 가능(모집중) 공고 수 (loadPrograms 결과)
 *  - cumulative: 누적 연동 공고 수 (마감 포함) — 메타데이터 기반 합계 + 기업마당 활성분
 * 둘 다 1시간 캐시되므로 이 호출도 거의 캐시에서 즉시 응답한다.
 */
export async function GET() {
  const [{ programs }, cumulativeOthers] = await Promise.all([
    loadPrograms(),
    loadCumulativeTotal(),
  ]);

  const bySource: Record<string, number> = {};
  for (const p of programs) {
    const s = p.source ?? "기타";
    bySource[s] = (bySource[s] ?? 0) + 1;
  }

  // 기업마당은 totalCount를 안 줘(모집중 피드) 누적 합계에서 빠지므로, 활성 건수를 더한다.
  const cumulative = cumulativeOthers + (bySource["기업마당"] ?? 0);

  const body: StatsResponse = {
    total: programs.length,
    cumulative,
    bySource,
    sourceCount: Object.keys(bySource).length,
  };

  return NextResponse.json(body);
}
