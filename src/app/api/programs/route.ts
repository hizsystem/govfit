import { NextResponse } from "next/server";
import type { DataSource, SupportProgram } from "@/lib/types";
import { loadPrograms } from "@/lib/data/loader";

// 여러 공공 OpenAPI를 병렬 집계하므로 기본 함수 타임아웃보다 여유를 둔다.
// loadPrograms는 1시간 캐시되어 보통 즉시 응답하지만, 콜드 스타트 시 집계가 길 수 있다.
export const maxDuration = 30;

interface ProgramsResponse {
  /** 지금 신청 가능한(모집중) 공고 전부 — 중복 제거 후 */
  programs: SupportProgram[];
  /** 총 건수 */
  total: number;
  /** 소스별 건수 */
  bySource: Record<string, number>;
  /** 데이터 출처 (bizinfo=공공 API 실시간, sample=내장 샘플) */
  dataSource: DataSource;
}

/**
 * GET /api/programs
 *
 * 우리가 연동 중인 "지금 신청 가능한" 지원사업 전체 목록을 반환한다.
 * (회사 정보와 무관한 전체 둘러보기/검색용. 검색·필터는 클라이언트에서 처리한다.)
 * loadPrograms 결과가 1시간 캐시되므로 이 호출도 거의 캐시에서 즉시 응답한다.
 */
export async function GET() {
  const { programs, source } = await loadPrograms();

  const bySource: Record<string, number> = {};
  for (const p of programs) {
    const s = p.source ?? "기타";
    bySource[s] = (bySource[s] ?? 0) + 1;
  }

  const body: ProgramsResponse = {
    programs,
    total: programs.length,
    bySource,
    dataSource: source,
  };

  return NextResponse.json(body);
}
