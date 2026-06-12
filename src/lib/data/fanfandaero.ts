import type { Category, SupportProgram } from "@/lib/types";
import { REGIONS } from "@/lib/constants";
import { clean, truncate } from "@/lib/data/bizinfo";

/**
 * 판판대로(중소기업유통센터) 판로·유통 지원사업 공고 연동.
 *
 * 판판대로는 공고용 OpenAPI 대신, 목록 화면이 호출하는 AJAX JSON 엔드포인트를
 * 그대로 사용한다(공개 포털, 인증 불필요). 응답이 깔끔한 JSON이라 aT(HTML 파싱)보다
 * 안정적이다. 호출이 실패하면 예외를 던지고 상위 loader가 다른 소스로 폴백한다.
 *
 *   목록(JSON): POST /portal/v2/selectSprtBizPbancList.do  (body: pageIndex/pageUnit)
 *   문의처(JSON): POST /portal/v2/selectSprtBizPbancDetailSummaryList.do (body: sprtBizCd)
 *   상세(사용자용): /portal/v2/preSprtBizPbancDetail.do?sprtBizCd={코드}
 *
 * 목록은 현재 모집중(progrsSttusCd=10003233)만 반환한다. cn·기관명·해시태그·문의처
 * 필드는 목록 응답에선 비어 있어, 제목·유형·대상·세부분류로 표시 정보를 구성하고,
 * 문의처(담당자·전화)는 공고별 상세 요약 엔드포인트를 추가 호출해 채운다.
 */

const HOST = "https://fanfandaero.kr";
const LIST = `${HOST}/portal/v2/selectSprtBizPbancList.do`;
const DETAIL_SUMMARY = `${HOST}/portal/v2/selectSprtBizPbancDetailSummaryList.do`;

/** AJAX 호출 공통 헤더 */
const AJAX_HEADERS = {
  "User-Agent": "Mozilla/5.0",
  "X-Requested-With": "XMLHttpRequest",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  Accept: "application/json, */*",
  Referer: `${HOST}/portal/v2/preSprtBizPbanc.do`,
};

/** 한 번에 가져올 공고 수 (현재 전체가 30건 안팎이라 넉넉히) */
const PAGE_UNIT = 100;

interface FanItem {
  sprtBizCd?: string;
  sprtBizNm?: string;
  progrsSttusCd?: string;
  rcritBgngYmd?: string;
  rcritEndYmd?: string;
  sprtBizTyNm?: string; // 지원유형 (예: "유통∙판로")
  sprtBizTrgtNm?: string; // 지원대상 (예: "중기업,소기업,소상공인")
  sprtBizCtpvNm?: string | null; // 지원지역 (없으면 전국)
  sprtBizCg1Nm?: string | null; // 세부 분류 (예: "마케팅지원사업")
  aplyPsblYn?: string; // 신청 가능 여부 Y/N
}

/** 상세 요약 응답의 담당자 한 명 */
interface FanDamdang {
  userName?: string; // 담당자명
  userTelNo?: string; // 전화번호 (평문, 예 "02-6678-9815")
  userTlphonNo?: string; // 휴대폰(암호화) — 사용 안 함
  picAuthAplcnYn?: string; // 담당자 적용 여부 Y/N
}

/**
 * 판판대로 실시간 공고를 불러온다 (모집 진행 중인 것만).
 * @throws HTTP 오류·빈 응답 시 (상위 loader가 폴백)
 */
export async function fetchFanfandaeroPrograms(): Promise<SupportProgram[]> {
  const res = await fetch(LIST, {
    method: "POST",
    next: { revalidate: 60 * 60 }, // 1시간마다 갱신
    headers: AJAX_HEADERS,
    body: `pageIndex=1&pageUnit=${PAGE_UNIT}`,
    signal: AbortSignal.timeout(12_000), // 지연 시 빠르게 실패 → 다른 소스로 계속
  });
  if (!res.ok) throw new Error(`판판대로 HTTP ${res.status}`);

  const raw = (await res.json()) as { sprtBizApplList?: FanItem[] };
  const items = Array.isArray(raw?.sprtBizApplList) ? raw.sprtBizApplList : [];
  if (items.length === 0) throw new Error("판판대로 응답에 공고가 없습니다.");

  const programs = items
    .filter((it) => it.aplyPsblYn !== "N") // 신청 마감된 건 제외
    .map(toSupportProgram)
    .filter((p): p is SupportProgram => p !== null);

  // 문의처(담당자·전화)는 목록에 없어 공고별 상세 요약을 병렬로 추가 호출해 채운다.
  // 한 건이 실패해도 해당 공고만 문의처가 비고 나머지는 정상 동작한다.
  await Promise.allSettled(
    programs.map(async (p) => {
      const cd = p.id.replace(/^ff-/, "");
      const contact = await fetchContact(cd);
      if (contact) {
        p.contact = `${contact.person} ${contact.phone}`.trim() || undefined;
        p.contactPhone = contact.phone || undefined;
      }
    }),
  );

  return programs;
}

/**
 * 공고 한 건의 문의처(담당자명·전화번호)를 가져온다.
 * 담당자가 여러 명이면 적용 대상(picAuthAplcnYn='Y') 첫 사람을 사용한다.
 * 실패하거나 담당자가 없으면 null.
 */
async function fetchContact(
  sprtBizCd: string,
): Promise<{ person: string; phone: string } | null> {
  try {
    const res = await fetch(DETAIL_SUMMARY, {
      method: "POST",
      next: { revalidate: 60 * 60 },
      headers: AJAX_HEADERS,
      body: `sprtBizCd=${encodeURIComponent(sprtBizCd)}`,
      signal: AbortSignal.timeout(8_000), // 문의처 보강용 — 짧게 끊는다
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { damdangList?: FanDamdang[] };
    const list = Array.isArray(data?.damdangList) ? data.damdangList : [];
    const pick =
      list.find((d) => d.picAuthAplcnYn === "Y" && clean(d.userTelNo)) ??
      list.find((d) => clean(d.userTelNo));
    if (!pick) return null;

    return { person: clean(pick.userName), phone: clean(pick.userTelNo) };
  } catch {
    return null;
  }
}

function toSupportProgram(item: FanItem): SupportProgram | null {
  const title = clean(item.sprtBizNm);
  const cd = clean(item.sprtBizCd);
  if (!title || !cd) return null;

  const start = fmtDate(item.rcritBgngYmd);
  const end = fmtDate(item.rcritEndYmd);
  const deadline =
    start && end
      ? `${start} ~ ${end}`
      : end
        ? `~ ${end}`
        : "공고 참조";

  const ty = clean(item.sprtBizTyNm); // "유통∙판로"
  const cg = clean(item.sprtBizCg1Nm ?? undefined); // 세부 분류
  const target = clean(item.sprtBizTrgtNm);
  const summary = [cg, ty && `지원유형: ${ty}`, target && `지원대상: ${target}`]
    .filter(Boolean)
    .join(" · ");

  return {
    id: `ff-${cd}`,
    title,
    agency: "중소기업유통센터(판판대로)",
    category: mapCategory(cg, ty),
    summary: summary || truncate(title, 80),
    // 목록엔 본문(cn)이 없어, 키워드 매칭용으로 표시 가능한 텍스트를 모아 둔다.
    supportContent: [title, cg, ty, target].filter(Boolean).join(" "),
    amount: "공고 상세 참조",
    deadline,
    deadlineStart: start,
    deadlineEnd: end,
    url: `${HOST}/portal/v2/preSprtBizPbancDetail.do?sprtBizCd=${cd}`,
    target: target || undefined,
    source: "판판대로",
    subCategory: cg || undefined,
    contactOrg: "중소기업유통센터",
    hashtags: ["판로", "유통", ...(ty ? [ty] : [])],
    regions: fanRegions(item.sprtBizCtpvNm),
    industries: [],
    maxBusinessAgeYears: null,
    minBusinessAgeYears: null,
    maxEmployees: null,
    requiredTraits: [],
  };
}

/** 판판대로는 판로·유통 사업이 대부분 → 세부분류로 카테고리 세분화 */
function mapCategory(cg: string, ty: string): Category {
  const s = `${cg} ${ty}`;
  if (/수출|해외|글로벌|박람회|전시/.test(s)) return "수출/판로";
  if (/마케팅|홍보|광고|콘텐츠/.test(s)) return "홍보/마케팅";
  if (/창업/.test(s)) return "창업";
  if (/컨설팅|교육|상담|멘토/.test(s)) return "경영/컨설팅";
  return "수출/판로"; // 판로·유통이 기본
}

/** 지역명이 있으면 해당 시·도, 없거나 "전국"이면 제한 없음([]) */
function fanRegions(ctpv?: string | null): string[] {
  const s = clean(ctpv ?? undefined);
  if (!s || s.includes("전국")) return [];
  return (REGIONS as readonly string[]).filter((r) => s.includes(r));
}

/** "20260427" → "2026-04-27" */
function fmtDate(yyyymmdd?: string): string | undefined {
  const s = clean(yyyymmdd);
  if (!/^\d{8}$/.test(s)) return undefined;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
