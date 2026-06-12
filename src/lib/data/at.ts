import type { SupportProgram } from "@/lib/types";
import { clean, extractPhone } from "@/lib/data/bizinfo";

/**
 * 글로벌aT(한국농수산식품유통공사) 농식품 수출지원사업 공고 수집.
 *
 * aT는 공고용 OpenAPI를 제공하지 않아, 공개 게시판(HTML)을 파싱한다.
 *   목록: https://global.at.or.kr/front/bizReq/brList.do?_mtype=C&_dept1=3&page=N
 *   상세: /front/bizReq/brView.do?proj_id={no}&proj_detail_id={dno}
 * 표 구조: [번호, 지원분야, 공고명(goViewPage 링크), 접수기간, 상태, 담당자, 연락처]
 *
 * HTML 구조에 의존하므로 사이트 개편 시 깨질 수 있다. 그래서 실패하면 예외를
 * 던지고(상위 loader가 다른 소스로 폴백), 일부 행 파싱 실패는 건너뛴다.
 */

const HOST = "https://global.at.or.kr";
const LIST = `${HOST}/front/bizReq/brList.do?_mtype=C&_dept1=3`;

/** 수집할 목록 페이지 수 (페이지당 10건) */
const PAGES = 3;

export async function fetchAtPrograms(): Promise<SupportProgram[]> {
  const settled = await Promise.allSettled(
    Array.from({ length: PAGES }, (_, i) => fetchAtPage(i + 1)),
  );

  const out: SupportProgram[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") out.push(...r.value);
    else console.warn("[at] 페이지 수집 실패:", r.reason);
  }
  if (out.length === 0) throw new Error("aT 공고를 가져오지 못했습니다.");
  return out;
}

async function fetchAtPage(page: number): Promise<SupportProgram[]> {
  const res = await fetch(`${LIST}&page=${page}`, {
    next: { revalidate: 60 * 60 }, // 1시간마다 갱신
    headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`aT HTTP ${res.status}`);
  const html = await res.text();
  return parseListTable(html);
}

/** 목록 표를 파싱해 공고 배열로 변환 */
function parseListTable(html: string): SupportProgram[] {
  const start = html.indexOf("<table");
  if (start < 0) return [];
  const table = html.slice(start, html.indexOf("</table>", start) + 8);

  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  const programs: SupportProgram[] = [];

  for (const row of rows) {
    // 상세 링크 함수 goViewPage('proj_id','proj_detail_id') 가 있어야 데이터 행
    const idMatch = row.match(/goViewPage\('(\d+)'\s*,\s*'(\d+)'\)/);
    if (!idMatch) continue;
    const [, projId, detailId] = idMatch;

    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
      clean(m[1].replace(/<[^>]*>/g, " ")),
    );
    // [0]번호 [1]지원분야 [2]공고명 [3]접수기간 [4]상태 [5]담당자 [6]연락처
    const title = cells[2] || "";
    if (!title) continue;

    const status = cells[4] || "";
    if (status.includes("마감") || status.includes("종료")) continue; // 마감 공고 제외

    const period = cells[3] || "";
    const { start: dStart, end: dEnd } = parsePeriod(period);
    const contactPerson = cells[5] || "";
    const contactPhone = extractPhone(cells[6] || "");

    programs.push({
      id: `at-${projId}-${detailId}`,
      title,
      agency: "농림축산식품부 / 한국농수산식품유통공사(aT)",
      category: "수출/판로", // 글로벌aT(_mtype=C) = 농식품 수출지원
      summary: title,
      supportContent: title,
      amount: "공고 상세 참조",
      deadline: period || "공고 참조",
      deadlineStart: dStart,
      deadlineEnd: dEnd,
      url: `${HOST}/front/bizReq/brView.do?proj_id=${projId}&proj_detail_id=${detailId}`,
      source: "aT(농식품수출)",
      contact:
        [contactPerson, cells[6]].filter(Boolean).join(" ") || undefined,
      contactOrg: "한국농수산식품유통공사",
      contactPhone,
      hashtags: ["농식품", "수출", "해외진출"],
      views: 0,
      // 농식품 수출지원 = 전국·전 농식품 업종 대상이라 하드 조건은 비워둔다.
      industries: [],
      regions: [],
      maxBusinessAgeYears: null,
      minBusinessAgeYears: null,
      maxEmployees: null,
      requiredTraits: [],
    });
  }
  return programs;
}

/** "2026-06-11~2026-06-26" → {start,end}. 한쪽만 있으면 그것만 채운다 */
function parsePeriod(text: string): { start?: string; end?: string } {
  const dates = text.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  return { start: dates[0], end: dates[1] };
}
