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

const CACHE_TTL_MS = 60 * 60 * 1000; // 집계 결과 1시간 캐시
let cache: { expires: number; value: LoadedPrograms } | null = null;
let inflight: Promise<LoadedPrograms> | null = null;

/**
 * 추천에 사용할 지원사업 목록을 불러온다 (1시간 인메모리 캐시).
 *
 * 처음엔 Next의 `unstable_cache`로 집계 결과를 캐시했으나, 결과가 수 MB라
 * "2MB 초과는 캐시 불가" 한계에 걸려 저장이 매번 실패 → 매 요청 전 소스를
 * 재집계하며 외부 API 쿼터를 소진하고, 무거운 보조금24가 타임아웃에 걸려
 * 일부 소스가 통째로 누락됐다. 그래서 프로세스 메모리에 직접 캐시한다(2MB 제한 없음).
 * 동시 요청은 `inflight`로 합쳐 콜드 스타트 때 같은 집계가 중복 실행되는 것을 막는다.
 */
export async function loadPrograms(): Promise<LoadedPrograms> {
  if (cache && cache.expires > Date.now()) return cache.value;
  if (inflight) return inflight; // 진행 중인 집계가 있으면 그 결과를 공유

  inflight = loadProgramsUncached()
    .then((value) => {
      // 실데이터일 때만 캐시한다. 샘플 폴백은 캐시하지 않아 곧바로 재시도된다.
      if (value.source !== "sample") {
        cache = { expires: Date.now() + CACHE_TTL_MS, value };
      }
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

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
