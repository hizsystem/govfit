import { NextResponse } from "next/server";
import type { CompanyProfile, RecommendResponse } from "@/lib/types";
import { loadPrograms } from "@/lib/data/loader";
import { filterPrograms } from "@/lib/filter";
import { scoreCandidates } from "@/lib/match";

/**
 * POST /api/recommend
 *
 * 회사 정보를 받아 (1) 규칙 필터링 → (2) AI 적합도 평가 순으로
 * 추천 지원사업 목록을 반환한다.
 */
export async function POST(request: Request) {
  let company: CompanyProfile;
  try {
    company = (await request.json()) as CompanyProfile;
  } catch {
    return NextResponse.json(
      { error: "잘못된 요청 형식입니다." },
      { status: 400 },
    );
  }

  if (!company.industry || !company.region) {
    return NextResponse.json(
      { error: "업종과 지역은 필수 입력입니다." },
      { status: 400 },
    );
  }

  // 0차: 지원사업 데이터 로드 (기업마당 실시간 → 실패 시 샘플 폴백)
  const { programs, source } = await loadPrograms();

  // 1차: 규칙 기반 필터링
  const candidates = filterPrograms(company, programs);

  // 2차: AI 적합도 평가 (키 없으면 규칙 기반 폴백)
  const { recommendations, aiUsed } = await scoreCandidates(company, candidates);

  const body: RecommendResponse = {
    recommendations,
    aiUsed,
    dataSource: source,
    notice:
      candidates.length === 0
        ? "입력하신 조건에 맞는 지원사업을 찾지 못했어요. 조건을 조금 넓혀보세요."
        : undefined,
  };

  return NextResponse.json(body);
}
