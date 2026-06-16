import { NextResponse } from "next/server";
import { loadPrograms } from "@/lib/data/loader";

interface StatsResponse {
  /** 연동된 지원사업 총 개수 (중복 제거 후) */
  total: number;
  /** 데이터 출처(소스)별 개수 */
  bySource: Record<string, number>;
  /** 연동 소스 수 */
  sourceCount: number;
}

/**
 * GET /api/stats
 *
 * 현재 연동된 지원사업 총 개수와 소스별 분포를 반환한다.
 * loadPrograms가 1시간 캐시되므로 이 호출도 거의 캐시에서 즉시 응답한다.
 */
export async function GET() {
  const { programs } = await loadPrograms();

  const bySource: Record<string, number> = {};
  for (const p of programs) {
    const s = p.source ?? "기타";
    bySource[s] = (bySource[s] ?? 0) + 1;
  }

  const body: StatsResponse = {
    total: programs.length,
    bySource,
    sourceCount: Object.keys(bySource).length,
  };

  return NextResponse.json(body);
}
