import type { CompanyProfile } from "@/lib/types";

interface SearchMeta {
  resultCount: number;
  aiUsed: boolean;
  dataSource: string;
}

/**
 * 검색 1건을 Google 시트(Apps Script 웹앱)에 기록한다.
 *
 * 관리자 분석용 — 사용자가 어떤 조건으로 검색하는지 모아 본다.
 * `GSHEET_WEBHOOK_URL`(Apps Script 웹앱 URL)이 설정돼 있을 때만 동작한다.
 * 추천 응답을 막지 않도록 호출부에서 next/server의 `after()`로 감싸 쓰고,
 * URL 미설정·네트워크 실패 등 모든 오류는 삼켜 추천 흐름에 영향이 없게 한다.
 */
export async function logSearch(
  company: CompanyProfile,
  meta: SearchMeta,
): Promise<void> {
  const url = process.env.GSHEET_WEBHOOK_URL;
  if (!url) return;

  const row = {
    ts: new Date().toISOString(),
    preFounder: company.preFounder,
    industry: company.industry,
    region: company.region,
    businessAgeYears: company.businessAgeYears,
    employeeCount: company.employeeCount,
    annualRevenueEok: company.annualRevenueEok,
    traits: company.traits.join(", "),
    interests: company.interests.join(", "),
    description: company.description,
    resultCount: meta.resultCount,
    aiUsed: meta.aiUsed,
    dataSource: meta.dataSource,
  };

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.warn("[analytics] 검색 기록 실패:", err);
  }
}
