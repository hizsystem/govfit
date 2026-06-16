import type { Category, SupportProgram } from "@/lib/types";
import { REGIONS } from "@/lib/constants";
import { clean, truncate, extractPhone } from "@/lib/data/bizinfo";

/**
 * 보조금24 / 정부·지자체 공공서비스(혜택) 연동 (행정안전부, data.go.kr).
 *
 * 정부 부처·지방자치단체·공공기관이 제공하는 공공서비스(정부 혜택) 목록을 받아
 * 기업/소상공인 대상 항목만 골라 우리 SupportProgram으로 변환한다.
 * - 키(GOV24_API_KEY)는 data.go.kr에서 "행안부_대한민국 공공서비스(혜택) 정보"
 *   활용신청 후 사용. data.go.kr 계정 단일 인증키.
 * - 다른 소스와 달리 '지자체 보조금'까지 포함해 커버리지가 넓다.
 *
 * 엔드포인트(odcloud REST):
 *   GET https://api.odcloud.kr/api/gov24/v3/serviceList?serviceKey&page&perPage
 * 응답: { currentCount, data: [...], totalCount, page, perPage }
 * 한글 필드: 서비스명/사용자구분/서비스분야/지원유형/소관기관명/소관기관유형/
 *           신청기한/신청방법/전화문의/지원내용/지원대상/상세조회URL/서비스ID/조회수
 */

const ENDPOINT = "https://api.odcloud.kr/api/gov24/v3/serviceList";
const PER_PAGE = 1000;
const MAX_PAGES = 12; // totalCount ~11,000 → 넉넉히. 비즈니스 필터 후 수천 건.

/** 보조금24 서비스 1건 (한글 키, 필요한 것만) */
interface Gov24Item {
  서비스ID?: string;
  서비스명?: string;
  서비스목적요약?: string;
  서비스분야?: string;
  사용자구분?: string;
  지원유형?: string;
  지원내용?: string;
  지원대상?: string;
  선정기준?: string;
  소관기관명?: string;
  소관기관유형?: string;
  신청기한?: string;
  신청방법?: string;
  전화문의?: string;
  상세조회URL?: string;
  조회수?: number | string;
}

/** 기업/소상공인 대상 신호 (이게 사용자구분에 있으면 우리 앱 대상으로 본다) */
const BIZ_TARGET = /소상공인|법인|기업|창업|중소|상인|사업자/;

/**
 * 보조금24 기업 대상 공공서비스를 불러온다.
 * 전체(~1.1만 건)를 페이지로 받아 기업/소상공인 대상만 남긴다(개인·가구 전용 제외).
 * @throws 키 미설정 시. (페이지 일부 실패는 무시하고 받은 만큼 반환)
 */
export async function fetchGov24Programs(): Promise<SupportProgram[]> {
  const key = process.env.GOV24_API_KEY;
  if (!key) throw new Error("GOV24_API_KEY 미설정");

  const out: SupportProgram[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `${ENDPOINT}?serviceKey=${key}` +
      `&page=${page}&perPage=${PER_PAGE}&returnType=JSON`;

    let items: Gov24Item[];
    try {
      const res = await fetch(url, {
        next: { revalidate: 60 * 60 },
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        // 첫 페이지부터 실패면 키/권한 문제 → 예외로 폴백 유도
        if (page === 1) throw new Error(`보조금24 API HTTP ${res.status}`);
        break;
      }
      const raw = (await res.json()) as { data?: Gov24Item[] };
      items = Array.isArray(raw?.data) ? raw.data : [];
    } catch (err) {
      if (page === 1) throw err;
      break; // 중간 페이지 실패는 받은 만큼만 사용
    }

    if (items.length === 0) break; // 더 없음
    for (const it of items) {
      if (!BIZ_TARGET.test(clean(it.사용자구분))) continue; // 기업 대상만
      const p = toSupportProgram(it);
      if (p) out.push(p);
    }
    if (items.length < PER_PAGE) break; // 마지막 페이지
  }

  if (out.length === 0) {
    throw new Error("보조금24 응답에 기업 대상 공고가 없습니다.");
  }
  return out;
}

function toSupportProgram(item: Gov24Item): SupportProgram | null {
  const title = clean(item.서비스명);
  if (!title) return null;

  const purpose = clean(item.서비스목적요약);
  const supportContent = clean(item.지원내용) || purpose || title;
  const target = clean(item.지원대상);
  const org = clean(item.소관기관명) || "정부24";
  const deadline = clean(item.신청기한) || "상시 / 공고 참조";
  const phone = extractPhone(clean(item.전화문의));
  const regions = mapRegion(item.소관기관명, item.소관기관유형);

  return {
    id: `gov24-${clean(item.서비스ID) || hashTitle(title)}`,
    title,
    agency: org,
    category: mapCategory(item.서비스분야, item.지원유형),
    summary: truncate(purpose || supportContent, 200) || title,
    purpose: purpose || undefined,
    supportSummary: truncate(clean(item.지원내용), 250) || undefined,
    eligibility: truncate(clean(item.선정기준) || target, 300) || undefined,
    supportContent,
    amount: "공고 상세 참조",
    deadline,
    deadlineStart: undefined,
    deadlineEnd: parseDeadlineEnd(deadline),
    url: clean(item.상세조회URL) || "https://www.gov.kr/portal/rcvfvrSvc/main",
    target: target || undefined,
    source: "보조금24",
    subCategory: clean(item.서비스분야) || undefined,
    applyMethod: truncate(clean(item.신청방법), 80) || undefined,
    contact: phone || clean(item.전화문의) || undefined,
    contactOrg: org,
    contactPhone: phone,
    views: Number(item.조회수) || 0,
    industries: [],
    regions,
    maxBusinessAgeYears: null,
    minBusinessAgeYears: null,
    maxEmployees: null,
    requiredTraits: [],
  };
}

/** 시·도 별칭 (소관기관명에서 지역 판별) */
const REGION_HINTS: Record<string, string[]> = {
  서울: ["서울"],
  부산: ["부산"],
  대구: ["대구"],
  인천: ["인천"],
  광주: ["광주"],
  대전: ["대전"],
  울산: ["울산"],
  세종: ["세종"],
  경기: ["경기"],
  강원: ["강원"],
  충북: ["충청북", "충북"],
  충남: ["충청남", "충남"],
  전북: ["전라북", "전북"],
  전남: ["전라남", "전남"],
  경북: ["경상북", "경북"],
  경남: ["경상남", "경남"],
  제주: ["제주"],
};

/**
 * 소관기관명/유형으로 지역을 판별한다.
 * 지자체(시·도/시군구)면 해당 시·도로, 중앙행정기관 등 전국 단위면 빈 배열(전국).
 */
function mapRegion(orgName?: string, orgType?: string): string[] {
  const type = clean(orgType);
  const name = clean(orgName);
  // 중앙행정기관·공공기관은 전국 단위로 본다
  if (/중앙행정기관|공공기관|준정부/.test(type)) return [];
  for (const region of REGIONS as readonly string[]) {
    const hints = REGION_HINTS[region] ?? [region];
    if (hints.some((h) => name.includes(h))) return [region];
  }
  return []; // 판별 불가 → 전국
}

/** 보조금24 서비스분야/지원유형 → 우리 카테고리 */
function mapCategory(field?: string, supportType?: string): Category {
  const f = clean(field);
  const t = clean(supportType);
  if (/융자|자금|보증|출자|투자/.test(`${t}${f}`)) return "자금/금융";
  if (/창업/.test(f)) return "창업";
  if (/고용|인력|일자리/.test(f)) return "인력/고용";
  if (/수출|판로|해외|무역/.test(`${f}${t}`)) return "수출/판로";
  if (/연구|기술|R&D|과학/.test(`${f}${t}`)) return "R&D";
  if (/홍보|마케팅|광고/.test(`${f}${t}`)) return "홍보/마케팅";
  if (/시설|공간|입주/.test(`${f}${t}`)) return "시설/공간";
  return "경영/컨설팅";
}

/**
 * 신청기한 자유 텍스트에서 종료일(YYYY-MM-DD)을 best-effort로 추출.
 * 대부분 상시/연중·다단계라 추출 불가 → undefined(캘린더에선 '마감일 미정').
 */
function parseDeadlineEnd(text: string): string | undefined {
  const m = text.match(/\d{4}-\d{2}-\d{2}/g);
  if (m && m.length > 0) return m[m.length - 1];
  return undefined;
}

function hashTitle(title: string): string {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
