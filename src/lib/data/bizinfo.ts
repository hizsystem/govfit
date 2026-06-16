import type { Category, SupportProgram } from "@/lib/types";

/**
 * 기업마당(bizinfo) 공공 OpenAPI 연동.
 *
 * 실시간 정부지원사업 공고를 받아 우리 앱의 SupportProgram 형태로 변환한다.
 * - 인증키(BIZINFO_API_KEY)는 기업마당에서 발급. https://www.bizinfo.go.kr (정책정보 개방)
 * - 키가 없거나 호출이 실패하면 예외를 던지고, 상위 로더가 샘플로 폴백한다.
 *
 * 응답 필드 참고:
 *   pblancId(공고ID) · pblancNm(공고명) · jrsdInsttNm(소관기관) · excInsttNm(수행기관)
 *   pldirSportRealmLclasCodeNm(지원분야) · reqstBeginEndDe(신청기간)
 *   bsnsSumryCn(사업개요) · pblancUrl(공고URL) · trgetNm(지원대상)
 */

const ENDPOINT = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do";
const HOST = "https://www.bizinfo.go.kr";

/** 전국 17개 시·도 (해시태그에서 지역을 판별하는 데 사용) */
const REGIONS = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기",
  "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
] as const;

/** 기업마당 응답의 공고 1건 (필요한 필드만, 모두 선택적으로 방어) */
interface BizinfoItem {
  pblancId?: string;
  pblancNm?: string;
  jrsdInsttNm?: string;
  excInsttNm?: string;
  pldirSportRealmLclasCodeNm?: string;
  pldirSportRealmMlsfcCodeNm?: string;
  reqstBeginEndDe?: string;
  reqstMthPapersCn?: string;
  refrncNm?: string;
  printFileNm?: string;
  bsnsSumryCn?: string;
  pblancUrl?: string;
  trgetNm?: string;
  hashtags?: string;
  inqireCo?: string | number;
}

/**
 * 기업마당 실시간 공고를 불러온다.
 * @param count 조회 건수 (기본 2000). 현재 오픈 공고 전량(~1,500건)을 덮을 만큼
 *   넉넉히 요청한다. 서버는 보유분만 반환하므로 과다 요청해도 응답은 실제 건수다.
 * @throws 키 미설정·HTTP 오류·빈 응답 시
 */
export async function fetchBizinfoPrograms(count = 2000): Promise<SupportProgram[]> {
  const programs = await fetchBizinfoBy("", count);
  if (programs.length === 0) {
    throw new Error("기업마당 응답에 공고가 없습니다.");
  }
  return programs;
}

/** 농업 관련 해시태그 (분야 필터가 없어 태그로 농업 공고를 추가로 수집) */
const AGRI_HASHTAGS = [
  "농업",
  "농식품",
  "축산",
  "수산",
  "농촌",
  "6차산업",
  "스마트팜",
  "임업",
];

/**
 * 농업 분야 공고를 해시태그별로 추가 수집한다.
 * 기본 fetch는 최신순 상한이 있어 농업 공고가 다른 부처 공고에 밀리므로,
 * 농업 태그로 따로 끌어와 커버리지를 넓힌다. (loader가 제목 기준 중복 제거)
 * 일부 태그 호출이 실패해도 나머지로 계속 동작한다.
 */
export async function fetchBizinfoAgriPrograms(): Promise<SupportProgram[]> {
  const settled = await Promise.allSettled(
    AGRI_HASHTAGS.map((tag) =>
      fetchBizinfoBy(`&hashtags=${encodeURIComponent(tag)}`, 100),
    ),
  );
  const out: SupportProgram[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") out.push(...r.value);
    else console.warn("[bizinfo] 농업 태그 수집 실패:", r.reason);
  }
  return out;
}

/** 기업마당 API 공통 호출부 (추가 쿼리 파라미터를 받아 공고 배열로 매핑) */
async function fetchBizinfoBy(
  extraParams: string,
  count: number,
): Promise<SupportProgram[]> {
  const key = process.env.BIZINFO_API_KEY;
  if (!key) {
    throw new Error("BIZINFO_API_KEY 미설정");
  }

  const url =
    `${ENDPOINT}?crtfcKey=${encodeURIComponent(key)}` +
    `&dataType=json&searchCnt=${count}${extraParams}`;

  const res = await fetch(url, {
    next: { revalidate: 60 * 60 }, // 1시간마다 최신 공고 갱신
    headers: { Accept: "application/json" },
    // 정부 서버 지연 시 빠르게 끊어 폴백을 살린다. 캐시 히트는 네트워크를
    // 타지 않으므로 영향 없음. (Vercel 함수 타임아웃으로 전체가 죽는 것 방지)
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new Error(`기업마당 API HTTP ${res.status}`);
  }

  const raw = (await res.json()) as unknown;

  // 기업마당은 인증 실패·잘못된 요청도 HTTP 200 + {reqErr:"..."}로 응답한다.
  if (raw && typeof raw === "object" && "reqErr" in raw) {
    throw new Error(`기업마당 API 오류: ${(raw as { reqErr: string }).reqErr}`);
  }

  return extractItems(raw)
    .map(toSupportProgram)
    .filter((p): p is SupportProgram => p !== null);
}

/** 응답 래퍼가 버전마다 다를 수 있어 방어적으로 공고 배열을 추출 */
function extractItems(raw: unknown): BizinfoItem[] {
  if (Array.isArray(raw)) return raw as BizinfoItem[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const candidate = obj.jsonArray ?? obj.items ?? obj.item ?? obj.list;
    if (Array.isArray(candidate)) return candidate as BizinfoItem[];
  }
  return [];
}

function toSupportProgram(item: BizinfoItem): SupportProgram | null {
  const title = clean(item.pblancNm);
  if (!title) return null; // 제목 없는 항목은 버림

  const agency =
    [clean(item.jrsdInsttNm), clean(item.excInsttNm)]
      .filter(Boolean)
      .join(" / ") || "기업마당";

  const fullDesc = clean(item.bsnsSumryCn);
  const summary = summarize(fullDesc) || truncate(title, 80);
  const purpose = extractPurpose(fullDesc);
  const supportSummary = extractSupport(fullDesc);
  const target = clean(item.trgetNm);
  const period = clean(item.reqstBeginEndDe) || "공고 참조";

  const { tags, regions } = parseHashtags(item.hashtags);
  const eligibility = extractEligibility(fullDesc);
  const { start, end } = parseDates(period);
  const contactRaw = clean(item.refrncNm);

  return {
    id: clean(item.pblancId) || `biz-${hashTitle(title)}`,
    title,
    agency,
    category: mapCategory(
      item.pldirSportRealmLclasCodeNm,
      item.pldirSportRealmMlsfcCodeNm,
    ),
    summary, // 요약
    purpose, // 사업 목적 ("~를 위하여" 부분)
    supportSummary, // 지원내용 (개요 전문에서 추출)
    eligibility, // 지원자격 조건 문구 (전체)
    supportContent: fullDesc || summary, // 전문
    amount: "공고 상세 참조",
    deadline: period,
    url: normalizeUrl(item.pblancUrl),
    target: target || undefined,
    source: "기업마당",
    subCategory: clean(item.pldirSportRealmMlsfcCodeNm) || undefined,
    deadlineStart: start,
    deadlineEnd: end,
    applyMethod: truncate(clean(item.reqstMthPapersCn), 80) || undefined,
    contact: truncate(contactRaw, 200) || undefined,
    contactOrg:
      clean(item.excInsttNm) || clean(item.jrsdInsttNm) || undefined,
    contactEmail: extractEmail(contactRaw),
    contactPhone: extractPhone(contactRaw),
    attachmentName: clean(item.printFileNm) || undefined,
    hashtags: tags.length > 0 ? tags : undefined,
    views: Number(item.inqireCo) || 0,
    // 기업마당 공고는 자격조건이 자유 텍스트라 업종·업력 등은 비워둔다(전부 통과).
    // 단, 해시태그로 지역을 판별할 수 있으면 지역만 하드 조건으로 사용한다.
    industries: [],
    regions,
    maxBusinessAgeYears: null,
    minBusinessAgeYears: null,
    maxEmployees: null,
    requiredTraits: [],
  };
}

/**
 * 해시태그를 주제 키워드와 지역으로 분리한다.
 * - 1번째 태그는 분야 대분류(카테고리와 중복)라 제외
 * - 지역 태그는 따로 모음. 10개 이상이면 "전국 대상"으로 보고 지역 제한 없음([])
 * - 나머지를 주제 키워드로 반환 (지역명·연도 숫자는 노이즈라 제외)
 */
function parseHashtags(raw?: string): { tags: string[]; regions: string[] } {
  const all = clean(raw)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (all.length === 0) return { tags: [], regions: [] };

  const regionTags = all.filter((t) => (REGIONS as readonly string[]).includes(t));
  const regions = regionTags.length >= 10 ? [] : regionTags; // 10+ → 전국

  const topic = all
    .slice(1) // 첫 태그(분야)는 제외
    .filter((t) => !(REGIONS as readonly string[]).includes(t)) // 지역명 제외
    .filter((t) => !/^\d{4}$/.test(t)) // 연도(2026 등) 제외
    .filter((t) => t.length >= 2);

  // 중복 제거, 최대 12개
  return { tags: Array.from(new Set(topic)).slice(0, 12), regions };
}

/**
 * 신청기간 텍스트에서 시작일·종료일(YYYY-MM-DD)을 뽑는다.
 * - 날짜 2개: 시작 ~ 종료
 * - 날짜 1개: 시작만 있고 종료는 "모집 완료시"처럼 열린 경우 → start만
 * - 날짜 0개: "사업별 상이" 등 → 둘 다 없음
 */
function parseDates(period: string): { start?: string; end?: string } {
  const dates = period.match(/\d{4}-\d{2}-\d{2}/g);
  if (!dates || dates.length === 0) return {};
  if (dates.length === 1) return { start: dates[0] };
  return { start: dates[0], end: dates[dates.length - 1] };
}

/**
 * 사업개요 전문에서 요약(목적·지원내용이 담긴 앞 문장)을 추출한다.
 * 한국 공고는 보통 "~를 위하여 ~사업을 모집/지원한다"로 시작하므로 첫 문장을 우선 사용.
 */
export function summarize(full: string): string {
  if (!full) return "";
  // 한국 공고문은 대부분 첫 문장이 '~니다(합니다/바랍니다/입니다 …)'로 끝난다.
  // 첫 '니다'까지를 요약으로 사용. 못 찾으면 앞부분을 잘라 사용.
  const m = full.match(/^.*?니다\.?/);
  const s = (m ? m[0] : full).trim();
  return truncate(s, 200);
}

/**
 * 사업 목적을 추출한다. 공고 개요는 보통 "○○를 위하여/위해 ~사업을 모집한다"로
 * 시작하므로, 첫 "~를 위하여/위해"까지를 목적으로 본다.
 */
export function extractPurpose(full: string): string | undefined {
  // 목적성 표현 바로 앞까지를 목적으로 본다.
  //   ~(하기/기/을/를) 위하여·위해·위한·위함,  ~하고자·고자·코자
  const m = full.match(
    /^(.{2,100}?)(?:(?:하?기|을|를)?\s*위(?:하여|해|한|함)|하?고자|코자)/,
  );
  if (!m) return undefined;
  // 끝에 남은 동사어간(하)·조사·구두점 정리
  let s = m[1]
    .trim()
    .replace(/[\s,·]+$/, "")
    .replace(/(?:하기|하고|하|을|를|이|가|의|에|와|과|및)$/, "")
    .trim();
  s = stripLeadingSubject(s);
  return s.length >= 2 ? s : undefined;
}

/**
 * 목적 앞의 "기관 주어"를 제거한다. 수행기관은 카드에 이미 표시되므로 목적에선 중복.
 * - 규칙1: "○○에서는 / ○○에서" (소재 표현, 명확해서 안전)
 * - 규칙2: 기관명 접미사(원·시·도·공사·재단·㈜ 등) + 은/는/이/가
 *   ('있는·하는' 같은 동사형의 '는'을 주격으로 오인하지 않도록 접미사로 한정)
 */
function stripLeadingSubject(s: string): string {
  let m = s.match(/^(.{2,30}?)(?:에서는|에서)\s+(.+)$/);
  if (m && m[2].length >= 6) return m[2].trim();

  m = s.match(
    /^.{2,30}?(?:테크노파크|파크|회사|법인|조합|공사|공단|재단|협회|센터|진흥원|평가원|진흥재단|혁신센터|기금|기관|시|도|군|구|원|청|부|회|단|\)|㈜)(?:은|는|이|가)\s+(.+)$/,
  );
  if (m && m[1].length >= 6) return m[1].trim();
  return s;
}

/**
 * 사업개요 전문에서 "지원내용"을 추출한다.
 * 기업마당 개요는 보통 "목적 … ☞지원대상 ☞지원내용 …" 구조 (☞로 블록 구분).
 *  1) 명시적 "지원내용/지원사항/지원규모" 라벨이 있으면 그 뒤를 사용
 *  2) 없으면 ☞ 블록 중 지원내용 신호(금액·%·상담·교육 등)가 있는 첫 블록
 *  3) 그래도 없으면 두 번째 ☞ 블록(보통 지원내용)
 */
function extractSupport(full: string): string | undefined {
  if (!full) return undefined;

  const lm = full.match(
    /(?:지원\s?내용|지원\s?사항|지원\s?규모|주요\s?내용)\s*[:：]?\s*([^☞※]{8,170})/,
  );
  if (lm) {
    const t = cleanFragment(lm[1]);
    if (t && !(t.length < 40 && /공고문|상이|참조/.test(t))) {
      return truncate(t, 250);
    }
  }

  // ☞ 첫 블록은 지원대상이므로 건너뛰고, 두 번째부터가 보통 지원내용
  const blocks = full
    .split("☞")
    .slice(1)
    .map((s) => s.split("※")[0].trim());
  const SIGNAL =
    /%|만원|억원|천원|비용|한도|최대|무료|바우처|상담|통역|컨설팅|교육|제공|보조금|융자|지원금|할인|입주|멘토링/;
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].length >= 8 && SIGNAL.test(blocks[i])) {
      return truncate(cleanFragment(blocks[i]), 250);
    }
  }
  if (blocks.length >= 2 && blocks[1].length >= 8) {
    return truncate(cleanFragment(blocks[1]), 250);
  }
  return undefined;
}

/**
 * 사업개요 전문에서 지원대상/자격 조건 문구를 통째로 추출한다.
 * 첫 ☞ 블록이 보통 지원대상이며, 그 안의 세부 조건(- 소재·업력 등)까지 함께 담는다.
 */
function extractEligibility(full: string): string | undefined {
  const blocks = full.split("☞").slice(1);
  if (blocks.length === 0) return undefined;
  const text = cleanFragment(blocks[0].split("※")[0]);
  return text.length >= 4 ? truncate(text, 300) : undefined;
}

/** 조각 앞뒤의 불릿·구두점 정리 */
function cleanFragment(t: string): string {
  return t
    .replace(/^[\s\-•·○ㆍ:：]+/, "")
    .replace(/[\s,·\-]+$/, "")
    .trim();
}

/** 텍스트에서 이메일 주소 추출 */
function extractEmail(text: string): string | undefined {
  const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0] : undefined;
}

/**
 * 텍스트에서 전화번호를 찾아 하이픈 형식으로 정규화한다.
 * 원본이 "0427107177"처럼 붙어 있어도, "042-710-7177"처럼 끊어서 반환한다.
 */
export function extractPhone(text: string): string | undefined {
  // 구분자(하이픈/점/공백)가 있든 없든 전화번호 후보를 잡는다.
  //  ① 대표번호(15xx/16xx/18xx + 4자리, 8자리) ② 지역번호/휴대폰(0XX + 3~4 + 4자리)
  const m = text.match(
    /1[5-9]\d{2}[\s.\-]?\d{4}|0\d{1,2}[\s.\-]?\d{3,4}[\s.\-]?\d{4}/,
  );
  if (!m) return undefined;
  return formatPhone(m[0]);
}

/** 숫자열을 한국 전화번호 하이픈 형식으로 만든다 (지역번호/휴대폰/대표번호 구분) */
function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  // 대표번호 (1544-0000 등, 8자리)
  if (d.length === 8 && /^1[5-9]/.test(d)) return `${d.slice(0, 4)}-${d.slice(4)}`;
  // 서울 02 (지역번호 2자리)
  if (d.startsWith("02")) {
    if (d.length === 9) return `02-${d.slice(2, 5)}-${d.slice(5)}`; // 02-XXX-XXXX
    if (d.length === 10) return `02-${d.slice(2, 6)}-${d.slice(6)}`; // 02-XXXX-XXXX
  }
  // 그 외 지역번호 3자리 / 휴대폰 (10~11자리)
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`; // 0XX-XXX-XXXX
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`; // 0XX-XXXX-XXXX
  return raw.trim(); // 규칙에 안 맞으면 원본 유지
}

/** 기업마당 지원분야(대분류+중분류)를 우리 카테고리로 매핑 */
function mapCategory(lclas?: string, mlsfc?: string): Category {
  // 중분류가 홍보·마케팅·광고 계열이면 별도 분야로 분리 (수출·내수·경영보다 우선)
  const sub = mlsfc ?? "";
  if (/홍보|마케팅|광고|판촉|브랜드/.test(sub)) return "홍보/마케팅";

  const f = lclas ?? "";
  if (f.includes("금융")) return "자금/금융";
  if (f.includes("기술") || f.includes("연구") || f.includes("R&D")) return "R&D";
  if (f.includes("인력") || f.includes("고용")) return "인력/고용";
  if (f.includes("수출") || f.includes("판로") || f.includes("내수")) return "수출/판로";
  if (f.includes("창업")) return "창업";
  if (f.includes("시설") || f.includes("공간") || f.includes("입지")) return "시설/공간";
  // 경영, 컨설팅, 기타 등은 경영/컨설팅으로 수렴
  return "경영/컨설팅";
}

/** 상대경로 URL이면 호스트를 붙여 절대경로로 */
function normalizeUrl(url?: string): string {
  const u = clean(url);
  if (!u) return HOST;
  if (u.startsWith("http")) return u;
  return `${HOST}${u.startsWith("/") ? "" : "/"}${u}`;
}

export function clean(s?: string): string {
  if (!s) return "";
  // HTML 태그·엔티티(&nbsp; 등) 제거 후 연속 공백 정리
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** id 누락 시 제목 기반의 안정적인 키 생성 (충돌 방지용 간단 해시) */
function hashTitle(title: string): string {
  let h = 0;
  for (let i = 0; i < title.length; i++) {
    h = (h * 31 + title.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
