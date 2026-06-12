import type { CompanyProfile, Recommendation } from "@/lib/types";

/** 사업계획서 초안 형식 */
export type ProposalFormat = "doc" | "marp";

/**
 * 공고 + 회사 정보로 사업계획서 초안(마크다운)을 조립한다.
 * AI 호출 없이 가진 데이터만으로 "내용이 채워진 맞춤 틀"을 만든다 (무료).
 *  - format "doc": 노션·워드에 붙여넣을 문서형
 *  - format "marp": Marp 슬라이드(발표자료)형 (--- 로 페이지 구분 + 헤더)
 */
export function buildProposal(
  rec: Recommendation,
  profile: CompanyProfile,
  format: ProposalFormat,
  today: string,
): string {
  const { program, matchedKeywords } = rec;

  const v = (s?: string) => (s && s.trim() ? s.trim() : "[ 작성 필요 ]");
  const num = (n: number, unit: string) =>
    n > 0 ? `${n}${unit}` : "[ 작성 필요 ]";
  const list = (arr: string[]) =>
    arr.length > 0 ? arr.join(", ") : "[ 작성 필요 ]";

  const fitBullets =
    matchedKeywords.length > 0
      ? matchedKeywords.map((k) => `  - ${k}`).join("\n")
      : "  - [ 우리 회사와 이 사업이 부합하는 점을 작성하세요 ]";

  // ---- 섹션별 본문 ----
  const sections: { title: string; body: string }[] = [
    {
      title: "1. 신청 사업 개요",
      body: [
        `- **지원사업명**: ${v(program.title)}`,
        `- **수행기관**: ${v(program.agency)}`,
        `- **분야**: ${program.category}${program.subCategory ? ` › ${program.subCategory}` : ""}`,
        `- **신청기간**: ${v(program.deadline)}`,
        `- **사업 목적**: ${v(program.purpose || program.summary)}`,
        `- **지원 내용**: ${v(program.supportSummary)}`,
        `- **지원 자격**: ${v(program.eligibility || program.target)}`,
      ].join("\n"),
    },
    {
      title: "2. 신청 기업 개요",
      body: [
        `- **기업명**: ${v(profile.name)}`,
        `- **업종**: ${v(profile.industry)}`,
        `- **소재지**: ${v(profile.region)}`,
        `- **업력**: ${num(profile.businessAgeYears, "년")}`,
        `- **상시 근로자**: ${num(profile.employeeCount, "명")}`,
        `- **연매출**: ${num(profile.annualRevenueEok, "억원")}`,
        `- **기업 특성**: ${list(profile.traits)}`,
        `- **기업 소개**: ${v(profile.description)}`,
      ].join("\n"),
    },
    {
      title: "3. 추진 배경 및 필요성",
      body: [
        `- 본 사업은 「${v(program.purpose || program.summary)}」을(를) 목적으로 합니다.`,
        `- 당사는 **${v(profile.industry)}** 분야 기업으로, 다음 점에서 본 사업과 부합합니다.`,
        fitBullets,
        `- [ 업계·시장 현황, 당사가 겪는 문제와 이 사업이 필요한 이유를 구체적으로 작성하세요 ]`,
      ].join("\n"),
    },
    {
      title: "4. 사업 목표",
      body: [
        "- **정량 목표**: [ 예: 매출 OO% 증대 / 신규 고용 O명 / 수출 O건 / 시제품 O종 ]",
        "- **정성 목표**: [ 예: 기술 경쟁력 확보, 브랜드 인지도 제고 등 ]",
      ].join("\n"),
    },
    {
      title: "5. 추진 내용 및 방법",
      body: [
        `- 본 지원사업(${v(program.supportSummary)})을 활용하여 다음을 추진합니다.`,
        "  1. [ 추진 과제 1 — 무엇을, 어떻게 ]",
        "  2. [ 추진 과제 2 ]",
        "  3. [ 추진 과제 3 ]",
      ].join("\n"),
    },
    {
      title: "6. 추진 일정",
      body: [
        "| 단계 | 추진 내용 | 기간 |",
        "|---|---|---|",
        "| 1단계 | [ ] | [ ] |",
        "| 2단계 | [ ] | [ ] |",
        "| 3단계 | [ ] | [ ] |",
      ].join("\n"),
    },
    {
      title: "7. 소요 예산 / 자금 활용 계획",
      body: [
        "| 항목 | 세부 내용 | 금액 |",
        "|---|---|---|",
        "| [ ] | [ ] | [ ] |",
        "| [ ] | [ ] | [ ] |",
        "| **합계** | | **[ ]** |",
      ].join("\n"),
    },
    {
      title: "8. 기대 효과",
      body: [
        "- **경제적 효과**: [ 매출·수출·고용 등 ]",
        "- **기술적 효과**: [ 기술 확보·개선 등 ]",
        "- **사회적 효과**: [ 지역경제 기여 등 ]",
      ].join("\n"),
    },
  ];

  const disclaimer =
    "이 문서는 공고·회사 정보로 자동 조립한 **초안 틀**입니다. " +
    "`[ ]` 부분을 채우고, 숫자·실적은 반드시 검토하세요. " +
    "정식 제출 양식은 공고 첨부 파일을 따르세요.";

  if (format === "marp") {
    const slides = [
      `---\nmarp: true\npaginate: true\n---\n\n# 사업계획서 (초안)\n\n### ${v(program.title)}\n\n신청기업: ${v(profile.name)} · ${today}\n\n<!-- ${disclaimer} -->`,
      ...sections.map((s) => `## ${s.title}\n\n${s.body}`),
    ];
    return slides.join("\n\n---\n\n") + "\n";
  }

  // 문서형
  return [
    `# 사업계획서 (초안)`,
    `> **${v(program.title)}** 신청용 · 작성일 ${today}`,
    `>`,
    `> ⚠️ ${disclaimer}`,
    "",
    ...sections.map((s) => `## ${s.title}\n\n${s.body}`),
  ].join("\n\n");
}
