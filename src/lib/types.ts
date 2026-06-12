// 회사 정보와 정부지원사업의 데이터 구조 정의

/** 지원 분야 카테고리 */
export type Category =
  | "자금/금융"
  | "R&D"
  | "수출/판로"
  | "홍보/마케팅"
  | "인력/고용"
  | "창업"
  | "경영/컨설팅"
  | "시설/공간";

/** 사용자가 입력하는 회사 정보 */
export interface CompanyProfile {
  /** 회사명 (선택) */
  name: string;
  /**
   * 예비창업자 여부. true면 아직 사업자등록 전이라 업력·근로자수·매출 정보가 없다.
   * 이 경우 그 값들은 0으로 두고, 창업 단계 지원사업을 우선 추천한다.
   */
  preFounder: boolean;
  /** 업종 (예비창업자는 창업 예정 분야) */
  industry: string;
  /** 소재 지역 (시·도) */
  region: string;
  /** 업력 (년). 예비창업자는 0 */
  businessAgeYears: number;
  /** 상시 근로자 수 */
  employeeCount: number;
  /** 연매출 (억원) */
  annualRevenueEok: number;
  /** 해당되는 특성 (수출기업, 여성기업 등) */
  traits: string[];
  /** 관심 지원 분야 */
  interests: Category[];
  /** 회사 소개 / 현재 상황 / 필요한 지원 (AI 매칭용 자유 서술) */
  description: string;
}

/** 정부지원사업 한 건 */
export interface SupportProgram {
  id: string;
  title: string;
  /** 주관 기관 */
  agency: string;
  category: Category;
  /** 한 줄 요약 */
  summary: string;
  /** 지원 내용 상세 */
  supportContent: string;
  /** 지원 규모 (예: "최대 5천만원") */
  amount: string;
  /** 신청 마감 */
  deadline: string;
  /** 상세 페이지 링크 */
  url: string;
  /** 지원대상 원문 (기업마당 trgetNm 등). 키워드 적합도 매칭·표시에 사용 */
  target?: string;
  /** 데이터 출처 (예: "기업마당", "K-Startup") */
  source?: string;

  // ---- 기업마당 실시간 공고에서 추가로 가져오는 표시용 정보 ----
  /** 지원분야 중분류 (예: "해외진출"). 대분류는 category */
  subCategory?: string;
  /** 사업 목적 ("~를 위하여" 부분만 추출). 없으면 요약으로 대체 표시 */
  purpose?: string;
  /** 지원내용 (개요 전문의 ☞지원내용 블록에서 추출) */
  supportSummary?: string;
  /** 지원자격 조건 문구 전체 (개요 전문의 ☞지원대상 블록에서 추출) */
  eligibility?: string;
  /** 신청기간 시작일 (YYYY-MM-DD). 파싱 불가 시 없음 */
  deadlineStart?: string;
  /** 신청기간 종료일 (YYYY-MM-DD). D-day 계산용. 열린 마감("모집 완료시")이면 없음 */
  deadlineEnd?: string;
  /** 신청방법 (예: "온라인 접수 (○○시스템)") */
  applyMethod?: string;
  /** 문의처 원문 (전화/이메일 섞임) */
  contact?: string;
  /** 주관/수행기관명 (문의처를 "기관(번호)"로 표시하는 데 사용) */
  contactOrg?: string;
  /** 문의처에서 분리한 이메일 */
  contactEmail?: string;
  /** 문의처에서 분리한 전화번호 */
  contactPhone?: string;
  /** 첨부 공고문 파일명 (있으면 상세 확인 유도) */
  attachmentName?: string;
  /** 공고 해시태그 (공고가 직접 단 주제 키워드). 부합 키워드 매칭·표시에 사용 */
  hashtags?: string[];
  /** 조회수 (기업마당 inqireCo). 뉴스레터 주목도 순위에 사용 */
  views?: number;

  // ---- 신청 자격 조건 (규칙 필터링에 사용) ----
  /** 적용 업종. 비어 있으면 전 업종 */
  industries: string[];
  /** 적용 지역. 비어 있으면 전국 */
  regions: string[];
  /** 업력 상한 (년). null이면 무관. 예: 창업 7년 이내 → 7 */
  maxBusinessAgeYears: number | null;
  /** 업력 하한 (년). null이면 무관 */
  minBusinessAgeYears: number | null;
  /** 근로자 수 상한. null이면 무관 */
  maxEmployees: number | null;
  /** 요구되는 특성 (있으면 회사가 모두 충족해야 함) */
  requiredTraits: string[];
}

/** 규칙 필터를 통과한 후보 + 통과 이유 */
export interface Candidate {
  program: SupportProgram;
  /** 규칙 기반으로 매칭된 이유 (예: "업종 일치", "업력 조건 충족") */
  matchedReasons: string[];
}

/** 최종 추천 결과 한 건 */
export interface Recommendation {
  program: SupportProgram;
  /** 적합도 점수 (0~100) */
  score: number;
  /** 추천 이유 (AI 또는 규칙 기반 설명) */
  reason: string;
  /** 규칙 기반으로 매칭된 이유 (점수 산정 근거로 표시) */
  matchedReasons: string[];
  /** 회사 정보와 공고 해시태그가 겹친 키워드 (강조 표시용) */
  matchedKeywords: string[];
}

/** 지원사업 데이터의 출처 */
export type DataSource = "bizinfo" | "sample";

/** /api/recommend 응답 형태 */
export interface RecommendResponse {
  recommendations: Recommendation[];
  /** AI 매칭이 실제로 사용됐는지 (false면 규칙 기반 폴백) */
  aiUsed: boolean;
  /** 추천에 사용된 지원사업 데이터 출처 (bizinfo=기업마당 실시간, sample=내장 샘플) */
  dataSource: DataSource;
  /** 후보가 0건일 때 등 안내 메시지 */
  notice?: string;
}
