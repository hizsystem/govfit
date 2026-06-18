/**
 * 연동 소스가 보유한 "누적 공고 수"(마감 포함)를 합산한다 — 헤더의 누적 지표용.
 *
 * 활성 집계(loadPrograms)와 달리 각 공공 API의 totalCount 메타데이터만 1건씩
 * 가볍게 읽어 합산한다(전체 데이터를 받지 않는다). 기업마당은 totalCount를 주지
 * 않는 모집중 피드라 여기서 제외하고, 호출부(/api/stats)에서 기업마당 활성 건수를
 * 더한다. 일부 소스 실패는 무시하고 받은 만큼 합산하며, 1시간 인메모리 캐시한다.
 *
 * ※ 마감·전(全)대상 포함 누적이므로 "지금 신청 가능"(loadPrograms 결과)과는 다른
 *    지표다. 화면에서도 두 숫자를 구분해 표시한다.
 */

const TTL_MS = 60 * 60 * 1000;
let cache: { expires: number; value: number } | null = null;
let inflight: Promise<number> | null = null;

/** 메타데이터 기반 누적 공고 수(기업마당 제외) — 1시간 캐시 */
export async function loadCumulativeTotal(): Promise<number> {
  if (cache && cache.expires > Date.now()) return cache.value;
  if (inflight) return inflight;

  inflight = computeTotal()
    .then((value) => {
      if (value > 0) cache = { expires: Date.now() + TTL_MS, value };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

async function computeTotal(): Promise<number> {
  const settled = await Promise.allSettled([
    kstartupTotal(),
    gov24Total(),
    msitTotal(),
    youthTotal(),
  ]);
  let sum = 0;
  for (const r of settled) {
    if (r.status === "fulfilled") sum += r.value;
    else console.warn("[cumulative] 소스 총계 조회 실패:", r.reason);
  }
  return sum;
}

/** totalCount 메타데이터만 받는 가벼운 GET (1건 요청) */
async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    next: { revalidate: 60 * 60 },
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** K-Startup 전체 공고 수(마감 포함) — 응답 top-level totalCount */
async function kstartupTotal(): Promise<number> {
  const key = process.env.KSTARTUP_API_KEY;
  if (!key) return 0;
  const j = (await getJson(
    `https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01` +
      `?serviceKey=${encodeURIComponent(key)}&page=1&perPage=1&returnType=json`,
  )) as { totalCount?: number | string };
  return Number(j?.totalCount) || 0;
}

/** 보조금24 전체 공공서비스 수 — odcloud totalCount */
async function gov24Total(): Promise<number> {
  const key = process.env.GOV24_API_KEY;
  if (!key) return 0;
  const j = (await getJson(
    `https://api.odcloud.kr/api/gov24/v3/serviceList` +
      `?serviceKey=${key}&page=1&perPage=1&returnType=JSON`,
  )) as { totalCount?: number | string };
  return Number(j?.totalCount) || 0;
}

/** 과기정통부 전체 사업공고 수 — 중첩 응답 response[1].body.totalCount */
async function msitTotal(): Promise<number> {
  const key = process.env.MSIT_API_KEY;
  if (!key) return 0;
  const j = (await getJson(
    `https://apis.data.go.kr/1721000/msitannouncementinfo/businessAnnouncMentList` +
      `?serviceKey=${key}&pageNo=1&numOfRows=1&returnType=json`,
  )) as { response?: Array<{ body?: { totalCount?: number | string } }> };
  const body = Array.isArray(j?.response) ? j.response[1]?.body : undefined;
  return Number(body?.totalCount) || 0;
}

/** 온통청년 전체 청년정책 수 — result.pagging.totCount */
async function youthTotal(): Promise<number> {
  const key = process.env.YOUTH_API_KEY;
  if (!key) return 0;
  const j = (await getJson(
    `https://www.youthcenter.go.kr/go/ythip/getPlcy` +
      `?apiKeyNm=${encodeURIComponent(key)}&pageNum=1&pageSize=1&rtnType=json`,
  )) as { result?: { pagging?: { totCount?: number | string } } };
  return Number(j?.result?.pagging?.totCount) || 0;
}
