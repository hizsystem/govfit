import type { Category, SupportProgram } from "@/lib/types";
import { clean, truncate, extractPhone } from "@/lib/data/bizinfo";

/**
 * 과학기술정보통신부 사업공고 연동 (data.go.kr).
 *
 * 과기정통부가 추진하는 R&D·공모·지원사업 공고를 받아온다. 단, 같은 목록에
 * 입찰·용역·계약 등 '조달성' 공고가 섞여 있어 지원사업 성격만 골라낸다.
 * 응답 본문이 제목·부서·연락처·게시일·첨부 위주라 내용은 얇다(상세는 링크로).
 * - 키(MSIT_API_KEY)는 data.go.kr "과학기술정보통신부_사업공고" 활용신청 후 사용.
 *
 * 엔드포인트(REST):
 *   GET https://apis.data.go.kr/1721000/msitannouncementinfo/businessAnnouncMentList
 *   params: serviceKey, pageNo, numOfRows, returnType=json
 * 응답: { response: [ {header}, {body:{ pageNo, totalCount, items:[{item:{...}}] }} ] }
 * item 필드: subject(제목)·viewUrl·deptName·managerName·managerTel·pressDt·files
 */

const ENDPOINT =
  "https://apis.data.go.kr/1721000/msitannouncementinfo/businessAnnouncMentList";
// 이 API는 페이지 크기를 10으로 고정한다(numOfRows를 키워도 10건 반환). 전체가
// 4천여 건이지만 대량 수집은 비현실적이라, 최신 ~100건만 훑어 지원성 공고만 추린다.
// (R&D 공고는 마감 지난 옛 공고보다 최신이 유효)
const NUM_OF_ROWS = 10;
const MAX_PAGES = 10;

interface MsitItem {
  subject?: string;
  viewUrl?: string;
  deptName?: string;
  managerName?: string;
  managerTel?: string;
  pressDt?: string;
  files?: unknown;
}

/** 지원사업이 아닌 '조달/행정성' 공고를 거르는 신호 (제목 기준) */
const EXCLUDE = /입찰|용역|구매|계약|낙찰|사전\s*규격|규격공개|견적|제안요청|RFP|채용|인사발령|결과\s*발표|선정\s*결과|정정\s*공고|재공고\s*안내|폐기|매각|임대/;
/** 기업이 참여할 만한 지원/공모성 신호 */
const INCLUDE = /공모|모집|지원|선정|육성|바우처|과제|사업\s*공고|참가|참여\s*기업|수요\s*조사|신청/;

/**
 * 과기정통부 지원성 공고를 불러온다 (최신순, 조달성 공고 제외).
 * @throws 키 미설정·첫 페이지 실패 시 (상위 loader가 폴백)
 */
export async function fetchMsitPrograms(): Promise<SupportProgram[]> {
  const key = process.env.MSIT_API_KEY;
  if (!key) throw new Error("MSIT_API_KEY 미설정");

  const out: SupportProgram[] = [];
  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
    const url =
      `${ENDPOINT}?serviceKey=${key}` +
      `&pageNo=${pageNo}&numOfRows=${NUM_OF_ROWS}&returnType=json`;

    let items: MsitItem[];
    try {
      const res = await fetch(url, {
        next: { revalidate: 60 * 60 },
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        if (pageNo === 1) throw new Error(`과기정통부 API HTTP ${res.status}`);
        break;
      }
      items = extractItems(await res.json());
    } catch (err) {
      if (pageNo === 1) throw err;
      break;
    }

    if (items.length === 0) break;
    for (const it of items) {
      const p = toSupportProgram(it);
      if (p) out.push(p);
    }
    if (items.length < NUM_OF_ROWS) break;
  }

  if (out.length === 0) {
    throw new Error("과기정통부 응답에 지원성 공고가 없습니다.");
  }
  return out;
}

/** 응답에서 item 배열을 방어적으로 추출 */
function extractItems(raw: unknown): MsitItem[] {
  if (!raw || typeof raw !== "object") return [];
  const resp = (raw as { response?: unknown }).response;
  const arr = Array.isArray(resp) ? resp : [resp];
  for (const part of arr) {
    const body = (part as { body?: { items?: unknown } })?.body;
    const items = body?.items;
    if (Array.isArray(items)) {
      return items.map((e) =>
        e && typeof e === "object" && "item" in e
          ? (e as { item: MsitItem }).item
          : (e as MsitItem),
      );
    }
  }
  return [];
}

function toSupportProgram(item: MsitItem): SupportProgram | null {
  const title = clean(item.subject);
  if (!title) return null;
  // 조달성 공고 제외, 지원성 신호가 있는 것만 채택
  if (EXCLUDE.test(title)) return null;
  if (!INCLUDE.test(title)) return null;

  const dept = clean(item.deptName);
  const agency = dept ? `과학기술정보통신부 / ${dept}` : "과학기술정보통신부";
  const phone = extractPhone(clean(item.managerTel));
  const pressDt = clean(item.pressDt);

  return {
    id: `msit-${hashTitle(title)}`,
    title,
    agency,
    category: mapCategory(title),
    summary: truncate(title, 120),
    supportContent: title,
    amount: "공고 상세 참조",
    deadline: "공고 참조",
    url: clean(item.viewUrl) || "https://www.msit.go.kr",
    source: "과기정통부",
    applyMethod: undefined,
    contact: phone || clean(item.managerTel) || undefined,
    contactOrg: agency,
    contactPhone: phone,
    // 게시일을 표시 보조로 (마감일 아님)
    subCategory: pressDt ? `게시 ${pressDt}` : undefined,
    industries: [],
    regions: [], // 전국 단위 부처 공고
    maxBusinessAgeYears: null,
    minBusinessAgeYears: null,
    maxEmployees: null,
    requiredTraits: [],
  };
}

/** 제목 키워드로 카테고리 추정 (과기정통부는 R&D가 기본) */
function mapCategory(title: string): Category {
  if (/창업|스타트업/.test(title)) return "창업";
  if (/수출|해외|글로벌/.test(title)) return "수출/판로";
  if (/인력|고용|일자리|양성|교육/.test(title)) return "인력/고용";
  if (/마케팅|홍보/.test(title)) return "홍보/마케팅";
  if (/자금|융자|투자|바우처/.test(title)) return "자금/금융";
  return "R&D";
}

function hashTitle(title: string): string {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
