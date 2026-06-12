import type { Category, SupportProgram } from "@/lib/types";
import { clean, extractPhone } from "@/lib/data/bizinfo";

/**
 * 서울경제진흥원(SBA, 옛 서울산업진흥원) 사업공고 연동.
 *
 * SBA는 공고용 OpenAPI를 제공하지 않고, 목록 화면(Posting.aspx)이 ASP.NET
 * GridView로 렌더된다. 다행히 목록 첫 페이지(최신 ~10건)는 서버에서 정적 HTML로
 * 내려오고, 각 레코드의 값이 안정적인 컨트롤 ID(GridView1_new_name_0 …)로 노출된다.
 * 그래서 표의 셀 위치가 아니라 ID로 값을 뽑아 레이아웃 변경에 비교적 강하다.
 *
 * 기업마당엔 없는 SBA 고유 공고(참가기업 모집·전시·IR 등)를 끌어오는 게 목적이며,
 * SBA는 '서울 소재 기업' 대상이라 regions=["서울"]로 매핑해 지역 필터가 정확히 걸린다.
 * HTML 구조에 의존하므로 사이트 개편 시 깨질 수 있다 → 실패하면 예외를 던지고
 * 상위 loader가 다른 소스로 폴백한다. (id 기준 dedup은 loader가 처리)
 *
 *   목록: https://www.sba.seoul.kr/Pages/BusinessApply/Posting.aspx
 *   상세: /Pages/BusinessApply/PostingDetail.aspx?mid={UUID}
 */

const HOST = "https://www.sba.seoul.kr";
const LIST = `${HOST}/Pages/BusinessApply/Posting.aspx`;
/** GridView 레코드 필드 ID 접두사 (뒤에 필드명_행번호가 붙는다) */
const GV = "ContentPlaceHolder1_MainContents_GridView1_";
/** 목록 첫 페이지의 레코드 수 상한 (현재 페이지당 10건, 여유 있게 둔다) */
const MAX_ROWS = 30;

export async function fetchSbaPrograms(): Promise<SupportProgram[]> {
  const res = await fetch(LIST, {
    next: { revalidate: 60 * 60 }, // 1시간마다 갱신
    headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
    signal: AbortSignal.timeout(12_000), // 지연 시 빠르게 실패 → 다른 소스로 계속
  });
  if (!res.ok) throw new Error(`SBA HTTP ${res.status}`);

  const html = await res.text();
  const programs = parsePostingList(html);
  if (programs.length === 0) {
    throw new Error("SBA 공고를 가져오지 못했습니다. (사이트 구조 변경 가능)");
  }
  return programs;
}

/** GridView 레코드를 행번호 0부터 훑어 공고로 변환 (접수 마감된 건 제외) */
function parsePostingList(html: string): SupportProgram[] {
  const out: SupportProgram[] = [];

  for (let i = 0; i < MAX_ROWS; i++) {
    const mid = inputValue(html, `${GV}new_displayId_${i}`);
    if (!mid) break; // 더 이상 레코드 없음

    const title = clean(spanText(html, `${GV}new_name_${i}`));
    if (!title) continue;

    const start = clean(spanText(html, `${GV}lb_receipt_start_${i}`)) || undefined;
    const end = clean(spanText(html, `${GV}lb_receipt_end_${i}`)) || undefined;
    if (end && isPast(end)) continue; // 접수 마감 공고 제외

    const target = clean(spanText(html, `${GV}lb_apply_templatename_${i}`));
    const dept = clean(spanText(html, `${GV}lb_teamname_${i}`));
    const person = clean(spanText(html, `${GV}lb_mainusername_${i}`));
    const rawPhone = clean(spanText(html, `${GV}lb_phone_${i}`));

    const period =
      start && end ? `${start} ~ ${end}` : end ? `~ ${end}` : "공고 상세 참조";

    out.push({
      id: `sba-${mid}`,
      title,
      agency: "서울경제진흥원(SBA)",
      category: inferCategory(title),
      summary: title,
      supportContent: title, // 본문은 상세 페이지에 있어 목록 단계에선 제목으로 대체
      amount: "공고 상세 참조",
      deadline: period,
      deadlineStart: start,
      deadlineEnd: end,
      url: `${HOST}/Pages/BusinessApply/PostingDetail.aspx?mid=${mid}`,
      target: target || undefined,
      source: "서울경제진흥원(SBA)",
      contact: [dept, person, rawPhone].filter(Boolean).join(" ") || undefined,
      contactOrg: "서울경제진흥원",
      contactPhone: extractPhone(rawPhone),
      hashtags: ["서울", "SBA"],
      views: 0,
      industries: [],
      regions: ["서울"], // SBA는 서울 소재 기업 대상 → 지역 하드 조건
      maxBusinessAgeYears: null,
      minBusinessAgeYears: null,
      maxEmployees: null,
      requiredTraits: [],
    });
  }

  return out;
}

/** GridView의 hidden input 값을 ID로 추출 */
function inputValue(html: string, id: string): string {
  const m = html.match(new RegExp(`id="${id}"[^>]*\\bvalue="([^"]*)"`));
  return m ? m[1].trim() : "";
}

/** GridView의 <span> 텍스트를 ID로 추출 (내부 태그 제거) */
function spanText(html: string, id: string): string {
  const m = html.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</span>`));
  return m ? m[1].replace(/<[^>]*>/g, " ") : "";
}

/** YYYY-MM-DD가 오늘(23:59:59 기준)보다 과거면 true */
function isPast(date: string): boolean {
  const t = new Date(`${date}T23:59:59`);
  if (Number.isNaN(t.getTime())) return false;
  return t.getTime() < Date.now();
}

/**
 * SBA 목록은 분야 텍스트를 안 주므로 제목 키워드로 카테고리를 추정한다.
 * (틀려도 표시·정렬용이라 치명적이지 않다. 못 맞추면 경영/컨설팅으로 수렴)
 */
function inferCategory(title: string): Category {
  if (/수출|해외|글로벌|무역|바이어|통상/.test(title)) return "수출/판로";
  if (/마케팅|홍보|전시|박람회|쇼|판로|유통|라이브\s?커머스|온라인몰|브랜드|팝업/.test(title))
    return "홍보/마케팅";
  if (/R&D|연구|기술개발|실증|특허|지식재산/.test(title)) return "R&D";
  if (/창업|스타트업|IR|피칭|데모데이|액셀러|스케일업|투자유치/.test(title))
    return "창업";
  if (/채용|인력|일자리|교육|양성|인턴|훈련|아카데미/.test(title)) return "인력/고용";
  if (/자금|융자|보증|투자|펀드|금융/.test(title)) return "자금/금융";
  if (/입주|공간|시설|메이커|스튜디오/.test(title)) return "시설/공간";
  return "경영/컨설팅";
}
