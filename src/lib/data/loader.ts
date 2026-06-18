import { unstable_cache } from "next/cache";
import type { DataSource, SupportProgram } from "@/lib/types";
import { PROGRAMS as SAMPLE_PROGRAMS } from "@/lib/data/programs";
import {
  fetchBizinfoPrograms,
  fetchBizinfoAgriPrograms,
} from "@/lib/data/bizinfo";
import { fetchKstartupPrograms } from "@/lib/data/kstartup";
import { fetchGov24Programs } from "@/lib/data/gov24";
import { fetchMsitPrograms } from "@/lib/data/msit";
import { fetchYouthPrograms } from "@/lib/data/youth";

export interface LoadedPrograms {
  programs: SupportProgram[];
  source: DataSource;
}

/**
 * 추천에 사용할 지원사업 목록을 불러온다.
 *
 * 집계 결과를 1시간 캐시한다. (핵심 성능 포인트)
 * 개별 fetch에도 revalidate가 걸려 있지만, Next의 fetch Data Cache는 GET만
 * 캐시한다. 판판대로는 list·상세를 POST로 호출해 매 요청 재실행(수십 번)됐고
 * 그게 응답 지연의 주범이었다. 그래서 GET/POST 구분 없이 집계 "결과 전체"를
 * 캐시해, 매 요청은 캐시를 읽어 필터·점수만 계산하도록 한다.
 * 만료되면 stale을 즉시 주고 백그라운드로 갱신 → 사용자는 거의 항상 빠르게 받는다.
 */
export const loadPrograms: () => Promise<LoadedPrograms> = unstable_cache(
  loadProgramsUncached,
  ["govfit-programs-v4"],
  { revalidate: 60 * 60 },
);

/**
 * 실제 다중 소스 집계 (느림 — 외부 공공 OpenAPI 호출). loadPrograms가 캐시한다.
 * 정부가 인증키로 공식 개방한 OpenAPI만 사용한다(공공저작물 자유이용·공공데이터법 범위).
 * HTML 스크래핑·비공식 내부 엔드포인트 소스(aT·SBA·판판대로)는 법적 회색지대라 제거했다.
 */
async function loadProgramsUncached(): Promise<LoadedPrograms> {
  const settled = await Promise.allSettled([
    fetchBizinfoPrograms(),
    fetchBizinfoAgriPrograms(), // 농업 분야 공고 추가 수집 (제목 기준 중복 제거됨)
    fetchKstartupPrograms(),
    fetchGov24Programs(), // 보조금24(행안부) 정부·지자체 공공서비스 중 기업 대상
    fetchMsitPrograms(), // 과학기술정보통신부 사업공고 (R&D·공모, 조달성 제외)
    fetchYouthPrograms(), // 온통청년 청년정책 중 일자리·창업·교육 분야만
  ]);

  const all: SupportProgram[] = [];
  settled.forEach((r) => {
    if (r.status === "fulfilled") all.push(...r.value);
    else console.warn("[loader] 소스 호출 실패:", r.reason);
  });

  if (all.length === 0) {
    return { programs: SAMPLE_PROGRAMS, source: "sample" };
  }
  return { programs: dedupeByTitle(all), source: "bizinfo" };
}

/**
 * 제목을 정규화해 동일 공고 중복 제거 (먼저 온 소스 우선).
 * 공백·괄호·구두점만 제거하고 한글/영숫자는 보존한다.
 * (JS의 \W는 한글까지 지우므로 쓰면 안 됨 — 그러면 서로 다른 공고가 오인 제거됨)
 */
function dedupeByTitle(programs: SupportProgram[]): SupportProgram[] {
  const seen = new Set<string>();
  const out: SupportProgram[] = [];
  for (const p of programs) {
    const key = p.title.replace(/[^가-힣a-z0-9]/gi, "").toLowerCase();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(p);
  }
  return out;
}
