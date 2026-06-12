import type { Candidate, CompanyProfile, SupportProgram } from "@/lib/types";

/**
 * 규칙 기반 1차 필터링.
 *
 * 회사 정보를 받아 자격 조건(업종/지역/업력/규모/특성)이 맞는 지원사업만
 * 후보로 추려서 반환한다. 각 후보에는 "왜 매칭됐는지" 이유도 함께 담는다.
 *
 * 샘플 데이터는 자격조건이 구조화돼 있어 하드 필터가 동작하고,
 * 기업마당 실시간 공고는 조건이 비어 있어(전부 통과) 자유 텍스트 기반
 * 소프트 매칭(업종·지역 언급)으로 매칭 이유를 보강한다.
 */
export function filterPrograms(
  company: CompanyProfile,
  programs: SupportProgram[],
): Candidate[] {
  const candidates: Candidate[] = [];

  for (const program of programs) {
    const result = evaluate(company, program);
    if (result.passed) {
      candidates.push({ program, matchedReasons: result.reasons });
    }
  }

  return candidates;
}

interface EvalResult {
  passed: boolean;
  reasons: string[];
}

function evaluate(company: CompanyProfile, program: SupportProgram): EvalResult {
  const reasons: string[] = [];

  // 업종: 지정된 업종이 있는데 일치하지 않으면 탈락
  if (program.industries.length > 0) {
    if (!program.industries.includes(company.industry)) {
      return { passed: false, reasons: [] };
    }
    reasons.push(`업종 일치 (${company.industry})`);
  }

  // 지역: 지정된 지역이 있는데 일치하지 않으면 탈락
  if (program.regions.length > 0) {
    if (!program.regions.includes(company.region)) {
      return { passed: false, reasons: [] };
    }
    reasons.push(`지역 조건 충족 (${company.region})`);
  }

  // 업력 상한
  if (program.maxBusinessAgeYears !== null) {
    if (company.businessAgeYears > program.maxBusinessAgeYears) {
      return { passed: false, reasons: [] };
    }
    reasons.push(`업력 ${program.maxBusinessAgeYears}년 이내 조건 충족`);
  }

  // 업력 하한
  if (program.minBusinessAgeYears !== null) {
    if (company.businessAgeYears < program.minBusinessAgeYears) {
      return { passed: false, reasons: [] };
    }
    reasons.push(`업력 ${program.minBusinessAgeYears}년 이상 조건 충족`);
  }

  // 근로자 수 상한
  if (program.maxEmployees !== null) {
    if (company.employeeCount > program.maxEmployees) {
      return { passed: false, reasons: [] };
    }
    reasons.push(`근로자 수 조건 충족`);
  }

  // 요구 특성: 프로그램이 요구하는 특성을 회사가 모두 가지고 있어야 함
  if (program.requiredTraits.length > 0) {
    const hasAll = program.requiredTraits.every((t) =>
      company.traits.includes(t),
    );
    if (!hasAll) {
      return { passed: false, reasons: [] };
    }
    reasons.push(`대상 요건 충족 (${program.requiredTraits.join(", ")})`);
  }

  // 업종 특화 공고 거르기: 공고가 특정 업종 전용인데 회사 업종과 다르면 탈락.
  // (기업마당 공고는 업종 조건이 정형 데이터로 없어, 텍스트 키워드로 판단)
  if (program.industries.length === 0 && isOtherIndustryOnly(company, program)) {
    return { passed: false, reasons: [] };
  }

  // 지역 특화 공고 거르기: 해시태그 지역이 없어도 본문/자격에 "OO 소재·OO지역" 등
  // 타지역 전용 신호가 있고 회사 지역과 다르면 탈락. (해시태그 지역 필터의 보강)
  if (program.regions.length === 0 && isOtherRegionOnly(company, program)) {
    return { passed: false, reasons: [] };
  }

  // ---- 자유 텍스트 기반 소프트 매칭 (주로 기업마당 실시간 공고용) ----
  // 구조화 조건이 비어 통과한 공고라도, 공고 텍스트에 업종·지역이 언급되면
  // 연관 신호로 기록한다. (탈락 조건이 아니라 가점 사유)
  const text = `${program.title} ${program.summary} ${program.supportContent} ${program.target ?? ""}`;
  if (program.industries.length === 0 && company.industry && text.includes(company.industry)) {
    reasons.push(`업종 연관 (${company.industry})`);
  }
  if (program.regions.length === 0 && company.region && text.includes(company.region)) {
    reasons.push(`지역 연관 (${company.region})`);
  }

  // 사업 목적과 회사 소개글의 키워드가 겹치면 근거로 기록
  const purposeHits = purposeMatchTokens(company, program);
  if (purposeHits.length > 0) {
    reasons.push(`사업 목적이 회사 소개와 부합 (${purposeHits.join(", ")})`);
  }

  // 관심 분야가 겹치면 가점 사유로 기록 (탈락 조건은 아님)
  if (company.interests.includes(program.category)) {
    reasons.push(`관심 분야와 일치 (${program.category})`);
  }

  // 예비창업자(사업자등록 전) 모드: '예비창업자도 신청 가능한' 공고만 남긴다.
  //  유지 조건 = ① 공고가 예비창업자를 대상으로 명시(중소기업과 둘 다 가능한 경우 포함
  //              → 사업자 모드와 양쪽에 노출) 또는
  //            ② 기존 사업체를 요구하지 않는 순수 창업 단계 공고(category 창업 등).
  //  그 외(기업 자격 요구·자격 불명확한 일반 공고)는 모두 탈락 → 탭이 창업 공고 위주로.
  if (company.preFounder) {
    const eligText = `${program.title} ${program.eligibility ?? ""} ${program.target ?? ""}`;
    const wide = `${text} ${program.eligibility ?? ""} ${(program.hashtags ?? []).join(" ")}`;

    // 공고 본문이 예비창업자를 명시적으로 배제하면(예: "예비창업자는 지원 불가") 무조건 탈락.
    // (mentionsPreFounder는 단순 포함이라 부정문도 긍정으로 오인하므로 이걸 먼저 본다)
    if (excludesPreFounder(wide)) {
      return { passed: false, reasons: [] };
    }

    const openToPreFounder = mentionsPreFounder(wide);

    // 비명시 공고는 '창업' 분야이면서 기존 사업체를 요구하지 않는 것만 인정한다.
    // (사업화·스타트업 같은 단어만으로는 실제 기업 대상이 새들어오므로 분야로 좁힘)
    const eligibleForPreFounder =
      openToPreFounder ||
      (program.category === "창업" && !requiresExistingBusiness(eligText));
    if (!eligibleForPreFounder) {
      return { passed: false, reasons: [] };
    }
    // 예비창업자를 명시한 공고를 더 위로 (match.ts에서 더 큰 가점)
    reasons.push(
      openToPreFounder ? "예비창업자 대상 사업(명시)" : "예비창업자 대상 사업",
    );
  } else if (
    // 사업자 + 업력이 짧으면(초기 창업기업): 초기·스타트업 공고를 우선 추천 사유로 기록.
    company.businessAgeYears > 0 &&
    company.businessAgeYears <= EARLY_STAGE_MAX_YEARS
  ) {
    const wide = `${text} ${(program.hashtags ?? []).join(" ")}`;
    if (isEarlyStageProgram(program, wide)) {
      reasons.push(`초기 창업기업 적합 (업력 ${company.businessAgeYears}년)`);
    }
  }

  // 농업/농식품 회사(또는 소개에 농업 용어)면 농업 분야 기관·공고를 우선 추천 사유로 기록.
  // (기업마당에 농림축산식품부·농업기술진흥원 등 공고가 섞여 들어오므로 끌어올린다)
  if (isAgriCompany(company) && isAgriProgram(program, text)) {
    reasons.push("농업 분야 지원기관 공고");
  }

  return { passed: true, reasons };
}

/** 회사가 농업/농식품 분야인지 — 업종이 농업이거나 소개글에 농업 용어가 있으면 true */
const AGRI_KEYWORDS = [
  "농업",
  "농식품",
  "농산물",
  "농촌",
  "스마트팜",
  "축산",
  "임업",
  "수산",
  "영농",
  "원예",
  "작물",
  "6차산업",
  "농가",
  "식품가공",
];
function isAgriCompany(company: CompanyProfile): boolean {
  if (company.industry.includes("농")) return true;
  const desc = company.description ?? "";
  return AGRI_KEYWORDS.some((kw) => desc.includes(kw));
}

/** 농업 분야 지원기관이 발주했거나 농업 키워드가 있는 공고인지 */
const AGRI_AGENCIES = [
  "농림축산식품부",
  "농업기술진흥원",
  "농림수산식품교육문화정보원",
  "농촌진흥청",
  "한국농수산식품유통공사",
  "농림식품기술기획평가원",
  "농어촌공사",
  "산림청",
  "임업진흥원",
  "해양수산부",
  "수산식품",
];
function isAgriProgram(program: SupportProgram, text: string): boolean {
  const agency = program.agency ?? "";
  if (AGRI_AGENCIES.some((a) => agency.includes(a))) return true;
  const haystack = `${text} ${(program.hashtags ?? []).join(" ")}`;
  return AGRI_KEYWORDS.some((kw) => haystack.includes(kw));
}

/** 공고가 '예비창업자도 신청 대상'임을 명시하는 신호 (있으면 사업자·예비창업 양쪽 노출) */
const PRE_FOUNDER_SIGNALS = [
  "예비창업",
  "예비 창업",
  "창업예정",
  "창업 예정",
  "창업희망",
  "창업 희망",
  "창업아이디어",
  "창업 아이디어",
];
/**
 * 공고가 예비창업자를 명시적으로 '배제'하는지 (예: "예비창업자는 지원 불가", "예비창업자 제외").
 * "예비창업" 등장 직후 짧은 구간(12자 이내)에 제외·불가류 표현이 있으면 배제로 판단한다.
 * (단순 포함 판정인 mentionsPreFounder가 부정문을 긍정으로 오인하는 것을 막기 위한 선판정)
 */
const PRE_FOUNDER_NEGATIONS = [
  "제외",
  "불가",
  "불인정",
  "지원불가",
  "신청불가",
  "참여불가",
  "지원 불가",
  "신청 불가",
  "참여 불가",
  "지원 제외",
  "신청 제외",
];
function excludesPreFounder(haystack: string): boolean {
  let idx = haystack.indexOf("예비창업");
  while (idx !== -1) {
    const window = haystack.slice(idx + 4, idx + 4 + 12); // "예비창업" 뒤 12자
    if (PRE_FOUNDER_NEGATIONS.some((n) => window.includes(n))) return true;
    idx = haystack.indexOf("예비창업", idx + 1);
  }
  return false;
}

function mentionsPreFounder(haystack: string): boolean {
  return PRE_FOUNDER_SIGNALS.some((kw) => haystack.includes(kw));
}

/**
 * 자격요건이 '이미 사업체가 있는' 대상을 요구하는 신호. 예비창업자(미등록)는 신청 불가.
 * 제목·지원대상·대상 텍스트(자격요건이 실제로 쓰이는 곳)만 본다 — 본문 부수 언급으로
 * 과도하게 거르지 않기 위함. ("예비창업" 명시가 있으면 이 판정은 무시된다)
 */
const EXISTING_BUSINESS_SIGNALS = [
  "중소기업",
  "중견기업",
  "소상공인",
  "사업자등록",
  "사업자 등록",
  "개인사업자",
  "법인사업자",
  "업력",
  "재직자",
  "창업기업",
  "기창업",
  "기존기업",
  "기존 기업",
];
function requiresExistingBusiness(eligText: string): boolean {
  return EXISTING_BUSINESS_SIGNALS.some((kw) => eligText.includes(kw));
}

/** 사업자라도 '초기 창업기업'으로 보는 업력 상한 (년). 이하면 초기·스타트업 공고를 가점 */
const EARLY_STAGE_MAX_YEARS = 3;

/**
 * 초기 창업기업(업력 짧은 사업자)에게 적합한 공고인지 — 가점 사유용.
 * 창업 단계 키워드에 더해 '창업기업·초기창업·창업도약'처럼 이미 등록된 초기기업 대상도 포함.
 */
const EARLY_STAGE_KEYWORDS = [
  "창업",
  "스타트업",
  "초기창업",
  "창업기업",
  "창업도약",
  "사업화",
  "시제품",
  "인큐베이",
  "액셀러레이",
  "스케일업",
];
function isEarlyStageProgram(program: SupportProgram, haystack: string): boolean {
  if (program.category === "창업") return true;
  return EARLY_STAGE_KEYWORDS.some((kw) => haystack.includes(kw));
}

/**
 * 특정 분야 "전용" 공고를 가르는 도메인별 키워드 맵.
 * 공고 텍스트에 이 키워드가 있으면 그 분야 전용으로 보고, 회사가 그 분야에
 * 속하지 않으면(업종명 일치 또는 소개/업종에 키워드 언급) 탈락시킨다.
 *
 * 앞쪽은 회사가 직접 고를 수 있는 업종, 뒤쪽(국방·로봇 등)은 선택지에는 없지만
 * 특정 산업 전용이라 소개에 해당 분야를 언급한 회사에만 노출해야 하는 도메인이다.
 * 여러 업종에 걸치는 모호한 단어(AI·데이터·수출·마케팅 등)는 일부러 제외한다.
 */
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  "바이오/헬스케어": [
    "의료기기", "바이오", "제약", "의약", "헬스케어", "임상", "신약",
    "진단기기", "보건의료", "의료기관", "백신", "디지털헬스",
  ],
  "농업/농식품": [
    "농식품", "농산물", "축산", "농촌", "농가", "농공상",
    "6차산업", "임업", "농업인", "스마트팜", "영농",
  ],
  "콘텐츠/미디어": [
    "웹툰", "만화", "게임", "애니메이션", "영화", "방송영상", "영상콘텐츠",
    "음악콘텐츠", "출판", "e스포츠", "캐릭터", "실감콘텐츠",
  ],
  "음식/외식": ["외식업", "음식점", "요식", "식당", "프랜차이즈", "베이커리"],
  건설: ["건설업", "건축", "토목", "플랜트", "시공", "건설현장"],
  // ↓ 회사 선택 업종은 아니지만, 해당 분야 전용 공고 (소개에 언급한 회사에만)
  "국방/방위": ["국방", "방산", "방위산업", "무기체계", "군수", "병영", "군사"],
  로봇: ["로봇"],
  "원자력/에너지": ["원자력", "방사선", "원전"],
  해양수산: ["해양수산", "수산물", "수산업", "수산식품", "어업", "양식업", "해양바이오"],
  "우주/항공": ["항공우주", "우주", "위성", "발사체"],
  반도체: ["반도체"],
  "조선/해운": ["조선업", "선박", "해운"],
};

/** "전 업종/업종 무관" 처럼 모든 업종 대상임을 알리는 표현 */
const GENERAL_INDUSTRY_MARKERS = [
  "전 업종", "전업종", "모든 업종", "업종 무관", "전 산업", "업종에 관계없이",
  "제한 없음", "전체 업종",
];

/** 회사가 특정 도메인에 속하는지 — 업종명이 일치하거나 소개/업종에 그 분야 키워드가 있으면 true */
function companyBelongsToDomain(
  company: CompanyProfile,
  domainKey: string,
  keywords: string[],
): boolean {
  if (company.industry === domainKey) return true;
  const companyText = `${company.industry} ${company.description}`;
  return keywords.some((k) => companyText.includes(k));
}

/**
 * 공고가 회사와 "다른 분야 전용"인지 판단.
 * - 공고에 특정 도메인 고유 키워드가 있고(국방·로봇·바이오 등)
 * - 공고가 묶인 도메인 중 회사가 속한 게 하나도 없으면 true (탈락 대상)
 * 특정 분야 색깔이 없거나(일반 사업) "전 업종" 표기가 있으면 false (유지)
 */
function isOtherIndustryOnly(
  company: CompanyProfile,
  program: SupportProgram,
): boolean {
  const text = `${program.title} ${program.summary} ${program.supportContent} ${
    program.subCategory ?? ""
  } ${(program.hashtags ?? []).join(" ")} ${program.target ?? ""}`;

  if (GENERAL_INDUSTRY_MARKERS.some((g) => text.includes(g))) return false;

  const lockedDomains = Object.entries(DOMAIN_KEYWORDS).filter(([, kws]) =>
    kws.some((k) => text.includes(k)),
  );

  if (lockedDomains.length === 0) return false; // 분야 색깔 없음 → 일반 사업
  // 공고가 묶인 분야 중 회사가 속한 게 하나라도 있으면 유지
  const belongs = lockedDomains.some(([key, kws]) =>
    companyBelongsToDomain(company, key, kws),
  );
  return !belongs;
}

/** 시·도 별칭 (본문이 "전라북도/전북" 등 다양하게 쓰므로 같이 매칭) */
const REGION_ALIASES: Record<string, string[]> = {
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
  충북: ["충북", "충청북"],
  충남: ["충남", "충청남"],
  전북: ["전북", "전라북"],
  전남: ["전남", "전라남"],
  경북: ["경북", "경상북"],
  경남: ["경남", "경상남"],
  제주: ["제주"],
};

/** 지역명 별칭들이 '신청 자격 지역 제한'을 함의하는 형태로 텍스트에 나오는지 */
function regionRestrictionHit(text: string, aliases: string[]): boolean {
  return aliases.some(
    (a) =>
      text.includes(`[${a}]`) ||
      text.includes(`${a} 소재`) ||
      text.includes(`${a}소재`) ||
      text.includes(`${a} 관내`) ||
      text.includes(`${a}관내`) ||
      text.includes(`${a}지역`) ||
      text.includes(`${a} 지역`) ||
      text.includes(`${a}에 소재`) ||
      text.includes(`${a} 기업만`),
  );
}

/**
 * 공고가 회사와 "다른 지역 전용"인지 판단 (해시태그 지역 정보가 없을 때 보강용).
 * - 본문/자격에 회사 지역이 제한 형태로 언급되면 → 회사도 대상이므로 유지(false)
 * - 다른 지역만 제한 형태로 언급되면 → 그 지역 전용으로 보고 탈락(true)
 * "전국/전 지역" 표기가 있으면 항상 유지. 기관 주소 오탐을 줄이려 "소재/관내/지역" 등
 * 자격을 함의하는 표현만 본다(광역시·특별시 단독 표기는 제외).
 */
function isOtherRegionOnly(
  company: CompanyProfile,
  program: SupportProgram,
): boolean {
  const text = `${program.title} ${program.eligibility ?? ""} ${
    program.target ?? ""
  } ${program.supportContent}`;

  if (/전국|전\s*지역|전지역/.test(text)) return false;

  const myAliases = REGION_ALIASES[company.region] ?? [company.region];
  if (regionRestrictionHit(text, myAliases)) return false; // 내 지역도 대상 → 유지

  for (const [region, aliases] of Object.entries(REGION_ALIASES)) {
    if (region === company.region) continue;
    if (regionRestrictionHit(text, aliases)) return true; // 다른 지역 전용 → 탈락
  }
  return false;
}

/** 흔한 공고 단어는 제외 (이게 겹쳐봐야 변별력이 없음) */
const PURPOSE_STOPWORDS = new Set([
  "지원", "사업", "기업", "중소", "위해", "위하여", "운영", "모집",
  "경영", "활용", "추진", "대상", "신청", "확대", "강화", "구축",
]);

/**
 * 회사 소개글의 키워드 중 사업 목적(없으면 요약)에 등장하는 것을 찾는다.
 * 흔한 공고 단어는 제외해 의미 있는 부합만 근거로 남긴다. (최대 2개)
 */
function purposeMatchTokens(
  company: CompanyProfile,
  program: SupportProgram,
): string[] {
  const purposeText = program.purpose ?? program.summary ?? "";
  if (!purposeText || !company.description) return [];

  const tokens = company.description
    .split(/[\s,.;·/()]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !PURPOSE_STOPWORDS.has(t));

  const hits: string[] = [];
  for (const t of tokens) {
    if (purposeText.includes(t) && !hits.includes(t)) hits.push(t);
    if (hits.length >= 2) break;
  }
  return hits;
}
