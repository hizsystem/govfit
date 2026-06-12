import type { Category, SupportProgram } from "@/lib/types";
import { CATEGORIES } from "@/lib/constants";

/** 한 분야의 주목 사업 묶음 */
export interface CategoryGroup {
  category: Category;
  programs: SupportProgram[];
}

/** 규모가 큰 사업일수록 (1) "억" 단위 금액 언급, (2) 조회수가 높은 경향 */
const hasEok = (p: SupportProgram) =>
  /억\s?원|억원|\d+\s?억/.test(
    `${p.supportSummary ?? ""} ${p.supportContent ?? ""} ${p.amount ?? ""}`,
  );

function byScale(a: SupportProgram, b: SupportProgram) {
  const ae = hasEok(a) ? 1 : 0;
  const be = hasEok(b) ? 1 : 0;
  if (ae !== be) return be - ae; // 억 단위 사업 우선
  return (b.views ?? 0) - (a.views ?? 0); // 그다음 조회수 높은 순
}

/**
 * 분야(카테고리)별로 주목 사업을 perCategory개씩 선정한다.
 * 사업이 있는 분야만 반환하며, 분야 순서는 CATEGORIES 정의 순서를 따른다.
 */
export function pickNewsletterByCategory(
  programs: SupportProgram[],
  perCategory = 5,
): CategoryGroup[] {
  return CATEGORIES.map((category) => ({
    category,
    programs: programs
      .filter((p) => p.category === category)
      .sort(byScale)
      .slice(0, perCategory),
  })).filter((g) => g.programs.length > 0);
}

/** 날짜로 "YYYY년 M월 N주차" 라벨을 만든다 */
export function weekLabel(date: Date): string {
  const week = Math.ceil(date.getDate() / 7);
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${week}주차`;
}

/** 분야별 선정 결과를 뉴스레터(마크다운)로 작성 */
export function buildNewsletter(
  groups: CategoryGroup[],
  label: string,
): string {
  const lines: string[] = [
    "# 📰 이번 주 분야별 주목 정부지원사업",
    `### ${label}`,
    "",
    "> Brand Rise가 분야별로 주목할 만한 지원사업을 모았어요. 마감일을 꼭 확인하세요!",
    "",
  ];

  for (const g of groups) {
    lines.push(`# ◆ ${g.category}`);
    lines.push("");
    g.programs.forEach((p, i) => {
      lines.push(`## ${i + 1}. ${p.title}`);
      lines.push(`- **주관/수행기관**: ${p.agency}`);
      lines.push(`- **신청기간**: ${p.deadline}`);
      if (p.supportSummary) lines.push(`- **지원내용**: ${p.supportSummary}`);
      if (p.eligibility) lines.push(`- **지원자격**: ${p.eligibility}`);
      lines.push(`- **자세히 보기**: ${p.url}`);
      lines.push("");
    });
  }

  lines.push("---");
  lines.push(
    "※ 본 뉴스레터는 참고용입니다. 정확한 자격·금액·마감은 각 공고 상세에서 확인하세요.",
  );
  return lines.join("\n");
}
