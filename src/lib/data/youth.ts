import type { Category, SupportProgram } from "@/lib/types";
import { REGIONS } from "@/lib/constants";
import { clean, truncate, summarize, extractPurpose } from "@/lib/data/bizinfo";

/**
 * 온통청년(한국고용정보원) 청년정책 OpenAPI 연동.
 *
 * 청년 대상 정책 중 GovFit 도메인(기업·창업·취업 지원사업)에 맞는 것만 가져온다.
 * 온통청년은 주거·복지·문화·참여 등 개인 대상 정책이 많아, 대분류(lclsfNm)가
 * '일자리' 또는 '교육·직업훈련'인 것만 추려 노이즈를 막는다.
 * - 인증키(YOUTH_API_KEY)는 온통청년(youthcenter.go.kr) 로그인 → 마이페이지 →
 *   OPEN API 신청 후 발급(심사형). data.go.kr serviceKey와 다른 UUID 형식이다.
 * - 키가 없거나 호출이 실패하면 예외를 던지고, 상위 로더가 다른 소스로 폴백한다.
 *
 * 엔드포인트(2023 개편 신버전):
 *   GET https://www.youthcenter.go.kr/go/ythip/getPlcy
 *   params: apiKeyNm(인증키) · pageNum · pageSize · rtnType=json
 * 응답: { resultCode, result: { pagging, youthPolicyList: [ {...} ] } }
 *   plcyNo(정책번호) · plcyNm(정책명) · plcyExplnCn(설명) · plcySprtCn(지원내용)
 *   lclsfNm(대분류)·mclsfNm(중분류) · plcyKywdNm(키워드) · sprvsnInstCdNm(주관기관)
 *   aplyYmd(신청기간) · aplyUrlAddr·refUrlAddr1(URL) · sprtTrgtMinAge~MaxAge(연령)
 */

const ENDPOINT = "https://www.youthcenter.go.kr/go/ythip/getPlcy";

/** 한 페이지 건수 / 가져올 페이지 수 (최신순. ~400건에서 도메인 일치분만 추림) */
const PAGE_SIZE = 100;
const PAGES = 4;

/** 온통청년 정책 1건 (필요한 필드만, 모두 선택적으로 방어) */
interface YouthItem {
  plcyNo?: string;
  plcyNm?: string;
  plcyExplnCn?: string;
  plcySprtCn?: string;
  lclsfNm?: string;
  mclsfNm?: string;
  plcyKywdNm?: string;
  sprvsnInstCdNm?: string;
  operInstCdNm?: string;
  rgtrInstCdNm?: string;
  aplyYmd?: string;
  aplyUrlAddr?: string;
  refUrlAddr1?: string;
  refUrlAddr2?: string;
  plcyAplyMthdCn?: string;
  addAplyQlfcCndCn?: string;
  ptcpPrpTrgtCn?: string;
  sprtTrgtMinAge?: string;
  sprtTrgtMaxAge?: string;
}

interface YouthResponse {
  resultCode?: number;
  result?: { youthPolicyList?: YouthItem[] };
}

/**
 * GovFit 도메인에 맞는 대분류만 통과시킨다.
 * '일자리'(취업·창업)와 '교육'(교육·직업훈련)만 사용하고, 주거·복지문화·참여기반은 제외.
 * (대분류 값에 특수 가운뎃점이 섞여 있어, '교육'은 startsWith로 안전하게 판별한다)
 */
function isBusinessRelevant(lclsf: string): boolean {
  return lclsf === "일자리" || lclsf.startsWith("교육");
}

/**
 * 온통청년 청년정책을 불러온다 (기업·창업·취업 관련만).
 * @throws 키 미설정·전 페이지 실패·결과 0건 시
 */
export async function fetchYouthPrograms(): Promise<SupportProgram[]> {
  const key = process.env.YOUTH_API_KEY;
  if (!key) throw new Error("YOUTH_API_KEY 미설정");

  const settled = await Promise.allSettled(
    Array.from({ length: PAGES }, (_, i) => fetchYouthPage(key, i + 1)),
  );

  const out: SupportProgram[] = [];
  let anyOk = false;
  for (const r of settled) {
    if (r.status === "fulfilled") {
      anyOk = true;
      out.push(...r.value);
    } else {
      console.warn("[youth] 페이지 수집 실패:", r.reason);
    }
  }
  if (!anyOk) throw new Error("온통청년 공고를 가져오지 못했습니다.");
  return out;
}

/** 한 페이지를 받아 도메인 일치 정책만 SupportProgram으로 변환 */
async function fetchYouthPage(key: string, page: number): Promise<SupportProgram[]> {
  const url =
    `${ENDPOINT}?apiKeyNm=${encodeURIComponent(key)}` +
    `&pageNum=${page}&pageSize=${PAGE_SIZE}&rtnType=json`;

  const res = await fetch(url, {
    next: { revalidate: 60 * 60 }, // 1시간마다 갱신
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000), // 지연 시 빠르게 실패 → 다른 소스로 계속
  });
  if (!res.ok) throw new Error(`온통청년 API HTTP ${res.status}`);

  const raw = (await res.json()) as YouthResponse;
  const items = raw.result?.youthPolicyList;
  if (!Array.isArray(items)) throw new Error("온통청년 응답 형식 오류");

  return items
    .filter((it) => isBusinessRelevant(clean(it.lclsfNm)))
    .map(toSupportProgram)
    .filter((p): p is SupportProgram => p !== null);
}

function toSupportProgram(item: YouthItem): SupportProgram | null {
  const title = clean(item.plcyNm);
  if (!title) return null;

  const expln = clean(item.plcyExplnCn);
  const support = clean(item.plcySprtCn);
  const agency =
    clean(item.sprvsnInstCdNm) || clean(item.operInstCdNm) || "온통청년";

  const { deadline, start, end } = parseApplyPeriod(item.aplyYmd);
  const url =
    firstUrl(item.aplyUrlAddr, item.refUrlAddr1, item.refUrlAddr2) ||
    "https://www.youthcenter.go.kr";

  const { tags } = parseKeywords(item.plcyKywdNm);

  return {
    id: `youth-${clean(item.plcyNo) || hashTitle(title)}`,
    title,
    agency,
    category: mapCategory(item.lclsfNm, item.mclsfNm, item.plcyKywdNm),
    summary: summarize(expln) || truncate(title, 80),
    purpose: extractPurpose(expln),
    supportSummary: truncate(support, 250) || undefined,
    eligibility: buildEligibility(item),
    supportContent: support || expln || title,
    amount: "공고 상세 참조",
    deadline,
    deadlineStart: start,
    deadlineEnd: end,
    url,
    target: clean(item.ptcpPrpTrgtCn) || undefined,
    source: "온통청년",
    subCategory: clean(item.mclsfNm) || undefined,
    applyMethod: truncate(clean(item.plcyAplyMthdCn), 80) || undefined,
    contactOrg: agency,
    hashtags: tags.length > 0 ? tags : undefined,
    // 청년정책은 업종 조건이 없고 개인 연령 기준이라, 업종·업력·근로자수는 비워
    // 전부 통과시키고(AI 매칭이 적합도 판단), 지역만 판별되면 하드 조건으로 쓴다.
    industries: [],
    regions: detectRegions(item),
    maxBusinessAgeYears: null,
    minBusinessAgeYears: null,
    maxEmployees: null,
    requiredTraits: [],
  };
}

/** 대분류·중분류·키워드로 GovFit 카테고리를 추정 (창업 > 자금 > 교육 > 고용 순) */
function mapCategory(lclsf?: string, mclsf?: string, kywd?: string): Category {
  const t = `${clean(mclsf)} ${clean(kywd)} ${clean(lclsf)}`;
  if (/창업/.test(t)) return "창업";
  if (/자금|금융|대출|융자|자산|보증|투자/.test(t)) return "자금/금융";
  if (/교육|훈련|양성|역량|연수|아카데미/.test(t)) return "경영/컨설팅";
  if (/취업|채용|고용|인턴|일경험|구직|일자리/.test(t)) return "인력/고용";
  return "인력/고용"; // 일자리 대분류 기본
}

/** 지원대상 자격 문구를 연령·대상·추가조건으로 구성 */
function buildEligibility(item: YouthItem): string | undefined {
  const min = clean(item.sprtTrgtMinAge);
  const max = clean(item.sprtTrgtMaxAge);
  const age =
    min && max ? `만 ${min}~${max}세 청년` : min ? `만 ${min}세 이상 청년` : "";
  const parts = [age, clean(item.ptcpPrpTrgtCn), clean(item.addAplyQlfcCndCn)]
    .filter(Boolean)
    .join(" / ");
  return parts ? truncate(parts, 300) : undefined;
}

/**
 * 신청기간(aplyYmd)에서 시작·종료일을 뽑는다.
 * 형식이 일정치 않아 8자리 날짜(YYYYMMDD) 토큰을 추출한다.
 * - 2개+: 시작 ~ 종료 / 1개: 시작만 / 0개(상시·미정): "상시 모집"
 */
function parseApplyPeriod(aplyYmd?: string): {
  deadline: string;
  start?: string;
  end?: string;
} {
  const dates = (clean(aplyYmd).match(/\d{8}/g) ?? []).map(fmtDate);
  if (dates.length === 0) return { deadline: "상시 모집 (공고 참조)" };
  if (dates.length === 1) return { deadline: `${dates[0]} ~`, start: dates[0] };
  const start = dates[0];
  const end = dates[dates.length - 1];
  return { deadline: `${start} ~ ${end}`, start, end };
}

/** "20260301" → "2026-03-01" */
function fmtDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/** 키워드(콤마 구분)를 태그 배열로 (최대 12개) */
function parseKeywords(raw?: string): { tags: string[] } {
  const tags = clean(raw)
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  return { tags: Array.from(new Set(tags)).slice(0, 12) };
}

/** 시·도 약칭 → 별칭(긴 행정구역명 포함). 기관명에서 지역을 판별하는 데 사용 */
const REGION_ALIASES: Record<string, string[]> = {
  충북: ["충북", "충청북도"],
  충남: ["충남", "충청남도"],
  전북: ["전북", "전라북도"],
  전남: ["전남", "전라남도"],
  경북: ["경북", "경상북도"],
  경남: ["경남", "경상남도"],
};

/**
 * 주관·운영·등록 기관명에서 지역(시·도)을 판별한다.
 * 예: "광주시청" → ["광주"], "경기도일자리재단" → ["경기"].
 * 중앙부처 등 지역이 안 잡히면 전국 대상으로 보고 빈 배열([]) — 지역 제한 없음.
 */
function detectRegions(item: YouthItem): string[] {
  const hay = [
    clean(item.sprvsnInstCdNm),
    clean(item.operInstCdNm),
    clean(item.rgtrInstCdNm),
  ].join(" ");
  for (const region of REGIONS) {
    const aliases = REGION_ALIASES[region] ?? [region];
    if (aliases.some((a) => hay.includes(a))) return [region];
  }
  return [];
}

/** 비어 있지 않은 첫 URL을 반환 (http로 시작하는 것만 유효) */
function firstUrl(...urls: (string | undefined)[]): string | undefined {
  for (const u of urls) {
    const c = clean(u);
    if (c && /^https?:\/\//.test(c)) return c;
  }
  return undefined;
}

/** id 누락 시 제목 기반 안정적 키 생성 (충돌 방지용 간단 해시) */
function hashTitle(title: string): string {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
