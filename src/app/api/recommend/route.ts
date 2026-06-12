import { NextResponse } from "next/server";
import type { CompanyProfile, RecommendResponse } from "@/lib/types";
import { loadPrograms } from "@/lib/data/loader";
import { filterPrograms } from "@/lib/filter";
import { scoreCandidates } from "@/lib/match";

// 여러 공공 API(기업마당·K-Startup·aT·판판대로)를 병렬 호출하므로
// Vercel 기본 함수 타임아웃보다 여유를 둔다. (각 fetch는 12초에 끊겨 폴백)
export const maxDuration = 30;

/**
 * POST /api/recommend
 *
 * 회사 정보를 받아 (1) 규칙 필터링 → (2) AI 적합도 평가 순으로
 * 추천 지원사업 목록을 반환한다.
 */
export async function POST(request: Request) {
  let raw: Partial<CompanyProfile>;
  try {
    raw = (await request.json()) as Partial<CompanyProfile>;
  } catch {
    return NextResponse.json(
      { error: "잘못된 요청 형식입니다." },
      { status: 400 },
    );
  }

  if (!raw.industry || !raw.region) {
    return NextResponse.json(
      { error: "업종과 지역은 필수 입력입니다." },
      { status: 400 },
    );
  }

  // 배열·숫자 필드가 빠진 요청이 와도 매칭 로직(.includes/.length 등)이
  // 터지지 않도록 안전한 기본값으로 정규화한다. (필수값은 위에서 검증)
  // 한글은 NFC로 정규화한다 — 지역·업종 문자열을 공고 데이터(NFC)와 정확히
  // 비교해야 하는데, 일부 클라이언트(특히 macOS IME)가 NFD로 보내면 같은
  // "서울"이라도 매칭에 실패하기 때문이다.
  const nfc = (s: string) => s.normalize("NFC");
  const company: CompanyProfile = {
    name: raw.name ?? "",
    preFounder: raw.preFounder ?? false,
    industry: nfc(raw.industry),
    region: nfc(raw.region),
    businessAgeYears: Number(raw.businessAgeYears) || 0,
    employeeCount: Number(raw.employeeCount) || 0,
    annualRevenueEok: Number(raw.annualRevenueEok) || 0,
    traits: Array.isArray(raw.traits) ? raw.traits.map(nfc) : [],
    interests: Array.isArray(raw.interests)
      ? (raw.interests.map(nfc) as CompanyProfile["interests"])
      : [],
    description: raw.description ? nfc(raw.description) : "",
  };

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
