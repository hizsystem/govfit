import type { Category, SupportProgram } from "@/lib/types";
import { REGIONS } from "@/lib/constants";
import {
  clean,
  truncate,
  summarize,
  extractPurpose,
  extractPhone,
} from "@/lib/data/bizinfo";

/**
 * K-Startup(창업진흥원) 사업공고 OpenAPI 연동.
 * - 인증키(KSTARTUP_API_KEY)는 공공데이터포털(data.go.kr)에서 발급.
 * - 키가 없거나 호출이 실패하면 예외를 던지고, 상위 로더가 다른 소스/샘플로 폴백한다.
 *
 * 응답 필드 참고:
 *   pbanc_sn(공고일련번호) · biz_pbanc_nm(사업공고명) · pbanc_ctnt(공고내용)
 *   supt_biz_clsfc(지원사업분류) · supt_regin(지원지역) · aply_trgt(신청대상)
 *   aply_trgt_ctnt(신청대상 상세) · pbanc_rcpt_bgng_dt~end_dt(접수기간)
 *   pbanc_ntrp_nm(공고기관) · biz_prch_dprt_nm(담당부서) · prch_cnpl_no(연락처)
 *   detl_pg_url(상세페이지) · rcrt_prgs_yn(모집진행여부)
 */

const ENDPOINT =
  "https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01";

interface KStartupItem {
  pbanc_sn?: number | string;
  biz_pbanc_nm?: string;
  pbanc_ctnt?: string;
  supt_biz_clsfc?: string;
  supt_regin?: string;
  aply_trgt?: string;
  aply_trgt_ctnt?: string;
  pbanc_rcpt_bgng_dt?: string;
  pbanc_rcpt_end_dt?: string;
  pbanc_ntrp_nm?: string;
  sprv_inst?: string;
  biz_prch_dprt_nm?: string;
  prch_cnpl_no?: string;
  detl_pg_url?: string;
  rcrt_prgs_yn?: string;
  aply_mthd_onli_rcpt_istc?: string;
  aply_mthd_vst_rcpt_istc?: string;
  aply_mthd_eml_rcpt_istc?: string;
  aply_mthd_fax_rcpt_istc?: string;
  aply_mthd_pssr_rcpt_istc?: string;
}

/**
 * K-Startup 실시간 공고를 불러온다 (모집 진행 중인 것만).
 * @throws 키 미설정·HTTP 오류·빈 응답 시
 */
export async function fetchKstartupPrograms(count = 300): Promise<SupportProgram[]> {
  const key = process.env.KSTARTUP_API_KEY;
  if (!key) throw new Error("KSTARTUP_API_KEY 미설정");

  const url =
    `${ENDPOINT}?serviceKey=${encodeURIComponent(key)}` +
    `&page=1&perPage=${count}&returnType=json`;

  const res = await fetch(url, {
    next: { revalidate: 60 * 60 }, // 1시간마다 최신 공고 갱신
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`K-Startup API HTTP ${res.status}`);

  const raw = (await res.json()) as { data?: KStartupItem[] };
  const items = Array.isArray(raw?.data) ? raw.data : [];
  if (items.length === 0) throw new Error("K-Startup 응답에 공고가 없습니다.");

  return items
    .filter((it) => it.rcrt_prgs_yn === "Y") // 모집 진행 중만
    .map(toSupportProgram)
    .filter((p): p is SupportProgram => p !== null);
}

function toSupportProgram(item: KStartupItem): SupportProgram | null {
  const title = clean(item.biz_pbanc_nm);
  if (!title) return null;

  const full = clean(item.pbanc_ctnt);
  const start = fmtDate(item.pbanc_rcpt_bgng_dt);
  const end = fmtDate(item.pbanc_rcpt_end_dt);
  const deadline =
    start && end
      ? `${start} ~ ${end}`
      : start
        ? `${start} ~ 모집 완료 시까지`
        : "공고 참조";

  const dept = clean(item.biz_prch_dprt_nm);
  const phoneRaw = clean(item.prch_cnpl_no);
  const phone = extractPhone(phoneRaw) || phoneRaw; // 하이픈 형식으로 정규화
  const org = clean(item.pbanc_ntrp_nm) || clean(item.sprv_inst) || "K-Startup";

  return {
    id: `ks-${item.pbanc_sn ?? hashTitle(title)}`,
    title,
    agency: org,
    category: mapKsCategory(item.supt_biz_clsfc),
    summary: summarize(full) || truncate(title, 80),
    purpose: extractPurpose(full),
    supportContent: full || title,
    eligibility: truncate(clean(item.aply_trgt_ctnt), 300) || undefined,
    amount: "공고 상세 참조",
    deadline,
    deadlineStart: start,
    deadlineEnd: end,
    url: clean(item.detl_pg_url) || "https://www.k-startup.go.kr",
    target: clean(item.aply_trgt) || undefined,
    source: "K-Startup",
    subCategory: clean(item.supt_biz_clsfc) || undefined,
    applyMethod: ksApplyMethod(item),
    contact: [dept, phone].filter(Boolean).join(" ") || undefined,
    contactOrg: org,
    contactPhone: phone || undefined,
    regions: ksRegions(item.supt_regin),
    industries: [],
    maxBusinessAgeYears: null,
    minBusinessAgeYears: null,
    maxEmployees: null,
    requiredTraits: [],
  };
}

/** K-Startup 지원사업분류 → 우리 카테고리 */
function mapKsCategory(clsfc?: string): Category {
  const c = clean(clsfc);
  if (/사업화|창업교육/.test(c)) return "창업";
  if (/기술개발|R&D|연구/.test(c)) return "R&D";
  if (/글로벌|판로|해외|수출/.test(c)) return "수출/판로";
  if (/시설|공간|보육|입주/.test(c)) return "시설/공간";
  if (/정책자금|융자|금융/.test(c)) return "자금/금융";
  if (/인력|고용/.test(c)) return "인력/고용";
  if (/홍보|마케팅/.test(c)) return "홍보/마케팅";
  if (/멘토링|컨설팅|교육|행사|네트워크|경영/.test(c)) return "경영/컨설팅";
  return "창업"; // K-Startup은 대부분 창업 사업
}

/** "전국"이면 지역 제한 없음([]), 아니면 해당 시·도 */
function ksRegions(supt_regin?: string): string[] {
  const s = clean(supt_regin);
  if (!s || s.includes("전국")) return [];
  return (REGIONS as readonly string[]).filter((r) => s.includes(r));
}

/** "20260520" → "2026-05-20" */
function fmtDate(yyyymmdd?: string): string | undefined {
  const s = clean(yyyymmdd);
  if (!/^\d{8}$/.test(s)) return undefined;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function ksApplyMethod(item: KStartupItem): string | undefined {
  if (clean(item.aply_mthd_onli_rcpt_istc)) return "온라인 접수";
  if (clean(item.aply_mthd_vst_rcpt_istc)) return "방문 접수";
  if (clean(item.aply_mthd_eml_rcpt_istc)) return "이메일 접수";
  if (clean(item.aply_mthd_fax_rcpt_istc)) return "팩스 접수";
  if (clean(item.aply_mthd_pssr_rcpt_istc)) return "우편 접수";
  return undefined;
}

function hashTitle(title: string): string {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
