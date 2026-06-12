import type { Category, SupportProgram } from "@/lib/types";
import {
  clean,
  extractPhone,
  extractPurpose,
  summarize,
  truncate,
} from "@/lib/data/bizinfo";

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

  // 목록엔 본문이 없어 제목만으로는 매칭 정확도가 낮다. 공고별 상세 페이지에서
  // 본문 전문(지원내용·자격·목적)·첨부 공고문명을 병렬로 보강한다.
  // 한 건이 실패해도 해당 공고는 목록 정보(제목·기간 등)로 그대로 노출된다.
  await Promise.allSettled(
    programs.map(async (p) => {
      const mid = p.id.replace(/^sba-/, "");
      const detail = await fetchSbaDetail(mid);
      if (detail.description) {
        p.supportContent = truncate(detail.description, 1800); // 전문 → 매칭 정확도↑
        p.summary = summarize(detail.description) || p.summary;
        const purpose = extractPurpose(detail.description);
        if (purpose) p.purpose = purpose;
      }
      if (detail.attachment) p.attachmentName = detail.attachment;
    }),
  );

  return programs;
}

/**
 * 공고 한 건의 상세 페이지에서 본문·첨부 공고문명을 가져온다.
 * 본문은 에디터 영역(div#new_ntxt_description)에, 첨부는 첫 파일 링크에 있다.
 * 실패·미발견 시 빈 객체를 반환해 호출부가 목록 정보만으로 계속 동작하게 한다.
 */
async function fetchSbaDetail(
  mid: string,
): Promise<{ description?: string; attachment?: string }> {
  const res = await fetch(`${HOST}/Pages/BusinessApply/PostingDetail.aspx?mid=${mid}`, {
    next: { revalidate: 60 * 60 },
    headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
    signal: AbortSignal.timeout(8_000), // 보강용 — 짧게 끊는다
  });
  if (!res.ok) throw new Error(`SBA 상세 HTTP ${res.status}`);
  const html = await res.text();

  const description = cleanRich(divById(html, "new_ntxt_description"));
  const att = html.match(/id="new_txt_fileupload_1"[^>]*>([\s\S]*?)<\/a>/);
  const attachment = att ? cleanRich(att[1]) : "";

  return {
    description: description.length >= 10 ? description : undefined,
    attachment: attachment || undefined,
  };
}

/**
 * 특정 id를 가진 <div>의 안쪽 HTML을 중첩 <div>까지 맞춰 잘라낸다.
 * (본문 에디터 영역은 내부에 <p>·<div>가 섞여 있어 단순 정규식으로는 못 자른다)
 */
function divById(html: string, id: string): string {
  const open = html.indexOf(`id="${id}"`);
  if (open < 0) return "";
  const gt = html.indexOf(">", open);
  if (gt < 0) return "";
  const re = /<\/?div\b[^>]*>/g;
  re.lastIndex = gt + 1;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(gt + 1, m.index);
  }
  return html.slice(gt + 1, gt + 4000); // 닫는 태그 못 찾으면 앞부분만
}

/** 본문용 정제 — 태그 제거 + 숫자·기호 엔티티(①·· 등)까지 풀어 읽기 좋게 */
function cleanRich(htmlFragment: string): string {
  return htmlFragment
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#39;|&apos;|&lsquo;|&rsquo;/gi, "'")
    .replace(/&middot;/gi, "·")
    .replace(/&hellip;/gi, "…")
    .replace(/\s+/g, " ")
    .trim();
}

/** 잘못된 코드포인트로 인한 예외를 막아 빈 문자열로 대체 */
function safeCodePoint(n: number): string {
  try {
    return String.fromCodePoint(n);
  } catch {
    return " ";
  }
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
