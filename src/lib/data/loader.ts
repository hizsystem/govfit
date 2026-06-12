import type { DataSource, SupportProgram } from "@/lib/types";
import { PROGRAMS as SAMPLE_PROGRAMS } from "@/lib/data/programs";
import {
  fetchBizinfoPrograms,
  fetchBizinfoAgriPrograms,
} from "@/lib/data/bizinfo";
import { fetchKstartupPrograms } from "@/lib/data/kstartup";
import { fetchAtPrograms } from "@/lib/data/at";
import { fetchFanfandaeroPrograms } from "@/lib/data/fanfandaero";
import { fetchSbaPrograms } from "@/lib/data/sba";

export interface LoadedPrograms {
  programs: SupportProgram[];
  source: DataSource;
}

/**
 * 추천에 사용할 지원사업 목록을 불러온다.
 *
 * 여러 공공 API(기업마당 · K-Startup …)를 동시에 호출해 합치고, 제목 기준으로
 * 중복을 제거한다. 모든 API가 실패하면 내장 샘플로 폴백한다.
 * (한 소스가 실패해도 나머지로 계속 동작.)
 */
export async function loadPrograms(): Promise<LoadedPrograms> {
  const settled = await Promise.allSettled([
    fetchBizinfoPrograms(),
    fetchBizinfoAgriPrograms(), // 농업 분야 공고 추가 수집 (제목 기준 중복 제거됨)
    fetchKstartupPrograms(),
    fetchAtPrograms(), // 글로벌aT 농식품 수출지원 공고 (HTML 파싱)
    fetchFanfandaeroPrograms(), // 판판대로(중소기업유통센터) 판로·유통 공고 (JSON)
    fetchSbaPrograms(), // 서울경제진흥원(SBA) 사업공고 (HTML 파싱, 서울 소재 기업 대상)
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
