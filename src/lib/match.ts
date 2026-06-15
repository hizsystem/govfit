import Anthropic from "@anthropic-ai/sdk";
import type {
  Candidate,
  CompanyProfile,
  Recommendation,
} from "@/lib/types";

/**
 * AI 기반 적합도 평가.
 *
 * 규칙 필터를 통과한 후보들을 Claude에게 넘겨 회사 상황과의 적합도를
 * 0~100점으로 평가하고 추천 이유를 생성한다.
 *
 * ANTHROPIC_API_KEY가 없거나 호출이 실패하면 규칙 기반 점수로 폴백한다.
 * (키 없이도 전체 흐름이 동작하도록.)
 */

// MVP 기본값은 비용 효율적인 Haiku 4.5. 필요하면 GOVFIT_MODEL로 교체.
const MODEL = process.env.GOVFIT_MODEL || "claude-haiku-4-5";

/** AI에 넘길 최대 후보 수 (실시간 데이터는 후보가 수백 건일 수 있어 상위만 추림) */
const AI_CANDIDATE_LIMIT = 25;
/** 화면 "전체" 탭으로 반환할 최대 건수 (조건에 맞는 것 다 보여주되 과도한 페이로드 방지) */
const MAX_RETURN = 100;

interface ScoreResult {
  recommendations: Recommendation[];
  aiUsed: boolean;
}

export async function scoreCandidates(
  company: CompanyProfile,
  candidates: Candidate[],
): Promise<ScoreResult> {
  if (candidates.length === 0) {
    return { recommendations: [], aiUsed: false };
  }

  // 후보가 많으면(실시간 기업마당 데이터) 규칙 점수로 미리 순위를 매겨
  // 상위 후보만 AI 평가에 넘긴다. 비용·지연·토큰 한도를 함께 제어.
  const ranked = ruleBasedScore(candidates, company);
  const shortlist = candidates.length > AI_CANDIDATE_LIMIT
    ? pickByIds(candidates, ranked.slice(0, AI_CANDIDATE_LIMIT))
    : candidates;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { recommendations: ranked.slice(0, MAX_RETURN), aiUsed: false };
  }

  try {
    // AI는 상위 후보만 평가하고, 나머지는 규칙 점수를 유지해 "전체"가 비지 않게 한다.
    const aiScores = await callClaude(company, shortlist, apiKey);
    const byAi = new Map(aiScores.map((s) => [s.id, s]));
    const merged = ranked.map((r) => {
      const ai = byAi.get(r.program.id);
      return ai ? { ...r, score: clamp(ai.score), reason: ai.reason } : r;
    });
    merged.sort((a, b) => b.score - a.score);
    return { recommendations: merged.slice(0, MAX_RETURN), aiUsed: true };
  } catch (err) {
    console.error("[match] AI 호출 실패, 규칙 기반으로 폴백합니다:", err);
    return { recommendations: ranked.slice(0, MAX_RETURN), aiUsed: false };
  }
}

/** ranked(점수순) 상위 후보의 id에 해당하는 원본 Candidate를 같은 순서로 추린다 */
function pickByIds(
  candidates: Candidate[],
  ranked: Recommendation[],
): Candidate[] {
  const byId = new Map(candidates.map((c) => [c.program.id, c]));
  return ranked
    .map((r) => byId.get(r.program.id))
    .filter((c): c is Candidate => c !== undefined);
}

// ---------------------------------------------------------------------------
// Claude 호출
// ---------------------------------------------------------------------------

interface AiScore {
  id: string;
  score: number;
  reason: string;
}

async function callClaude(
  company: CompanyProfile,
  candidates: Candidate[],
  apiKey: string,
): Promise<AiScore[]> {
  const client = new Anthropic({ apiKey });

  const candidateInfo = candidates.map((c) => ({
    id: c.program.id,
    title: c.program.title,
    category: c.program.category,
    summary: c.program.summary,
    supportContent: c.program.supportContent,
    agency: c.program.agency,
  }));

  const system =
    "당신은 한국의 정부지원사업 매칭 전문가입니다. " +
    "회사 정보와 후보 지원사업 목록을 보고, 각 사업이 이 회사에 얼마나 적합한지 " +
    "0~100점으로 평가하세요. 회사의 업종·규모·업력뿐 아니라 '회사 소개/필요 사항' 서술을 " +
    "특히 중요하게 반영하세요. 추천 이유는 한국어 한 문장으로, 이 회사에 왜 맞는지 " +
    "구체적으로 적으세요. 반드시 후보 목록에 있는 사업만 평가하고, 모든 후보를 평가하세요.";

  const userContent =
    `## 회사 정보\n` +
    (company.preFounder
      ? `- 단계: 예비창업자 (아직 사업자등록 전 — 업력·근로자수·매출 정보 없음). 창업 단계 지원사업을 우선 고려하세요.\n`
      : "") +
    `- 회사명: ${company.name || "(미입력)"}\n` +
    `- ${company.preFounder ? "창업 예정 분야" : "업종"}: ${company.industry}\n` +
    `- 지역: ${company.region}\n` +
    `- 업력: ${company.businessAgeYears}년\n` +
    `- 근로자 수: ${company.employeeCount}명\n` +
    `- 연매출: ${company.annualRevenueEok}억원\n` +
    `- 특성: ${company.traits.join(", ") || "없음"}\n` +
    `- 관심 분야: ${company.interests.join(", ") || "없음"}\n` +
    `- 회사 소개 / 필요 사항: ${company.description || "(미입력)"}\n\n` +
    `## 후보 지원사업 (${candidates.length}건)\n` +
    JSON.stringify(candidateInfo, null, 2);

  const schema = {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            score: { type: "integer" },
            reason: { type: "string" },
          },
          required: ["id", "score", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  };

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: userContent }],
    output_config: { format: { type: "json_schema", schema } },
  });

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("AI 응답에 텍스트 블록이 없습니다.");
  }

  const parsed = JSON.parse(text.text) as { results: AiScore[] };
  return parsed.results;
}

// ---------------------------------------------------------------------------
// 규칙 기반 점수 / 폴백
// ---------------------------------------------------------------------------

/**
 * 규칙 기반 점수 (AI 키 없을 때의 폴백).
 *
 * 객관적 6개 지표를 각각 0~만점으로 산출해 합산한다. 만점의 합은 100이며,
 * 모든 지표를 충족해야 100이 나오므로 포화되지 않고 0~100에 고르게 분포한다.
 *   ① 업종 적합도(0~22) ② 지역 적합도(0~13) ③ 관심분야 일치(0~15)
 *   ④ 내용 부합도(0~25) ⑤ 상황 적합도(0~15) ⑥ 신청 시의성(0~10)
 * 각 지표는 공고/회사의 정형 필드와 텍스트 겹침 등 확인 가능한 근거로만 매긴다.
 */
function ruleBasedScore(
  candidates: Candidate[],
  company: CompanyProfile,
): Recommendation[] {
  const keywords = profileKeywords(company);

  const recs = candidates.map((c) => {
    const p = c.program;
    const matchedKeywords = computeMatchedKeywords(company, p);
    const text = programText(p);

    // ① 업종 적합도 (0~22): 정형 자격 일치 > 본문에 업종 토큰 언급 > 업종 제한 없는 일반 공고.
    //    업종은 "농업/농식품"처럼 복합 라벨이라 토큰으로 쪼개 본문과 대조한다.
    const industryTokens = splitTokens(company.industry);
    const industryFit =
      p.industries.length > 0 && p.industries.includes(company.industry)
        ? 22
        : industryTokens.some((t) => text.includes(t))
          ? 18
          : 11;

    // ② 지역 적합도 (0~13): 정형 지역 일치 > 본문 언급 > 전국(제한 없음)
    const regionFit =
      p.regions.length > 0 && p.regions.includes(company.region)
        ? 13
        : company.region && text.includes(company.region)
          ? 13
          : 11;

    // ③ 관심분야 일치 (0~15): 회사가 고른 관심분야와 공고 분야 일치 여부
    const interestFit =
      company.interests.length === 0
        ? 9 // 미입력 → 판단 불가, 중립
        : company.interests.includes(p.category)
          ? 15
          : 7;

    // ④ 내용 부합도 (0~25): 회사 소개·업종 키워드(최대 18) + 공고 해시태그 겹침(최대 8.8).
    //    비정형 공고에서 변별력의 핵심이라 가중치를 높게 둔다.
    const hits = countKeywordHits(keywords, text);
    const contentFit =
      Math.min(hits, 6) * 3.0 + Math.min(matchedKeywords.length, 4) * 2.2;

    // ⑤ 상황 적합도 (0~15): 회사 특수상황(예비창업/초기창업/농업)과 공고 성격 일치
    let situationFit = 9; // 특수 상황 없음 → 중립
    if (
      company.preFounder &&
      c.matchedReasons.includes("예비창업자 대상 사업(명시)")
    ) {
      situationFit = 15;
    } else if (
      company.preFounder &&
      c.matchedReasons.includes("예비창업자 대상 사업")
    ) {
      situationFit = 11;
    } else if (c.matchedReasons.some((r) => r.startsWith("초기 창업기업 적합"))) {
      situationFit = 13;
    }
    if (c.matchedReasons.includes("농업 분야 지원기관 공고")) {
      situationFit = Math.max(situationFit, 13);
    }

    // ⑥ 신청 시의성 (0~10): 마감 여유
    const timeliness = scoreTimeliness(p.deadlineEnd);

    const score = clamp(
      industryFit +
        regionFit +
        interestFit +
        contentFit +
        situationFit +
        timeliness,
    );

    const reasonParts =
      c.matchedReasons.length > 0
        ? c.matchedReasons.join(", ")
        : "기본 신청 자격 충족";
    const reason = `${reasonParts} — 신청 자격에 부합하는 사업입니다.`;

    return {
      program: p,
      score,
      reason,
      matchedReasons: c.matchedReasons,
      matchedKeywords,
    };
  });

  // 점수 내림차순. 점수가 100점에 포화돼 동점이 많으므로, 예비창업자 모드에서는
  // '예비창업자 명시' 공고가 같은 점수면 먼저 오도록 타이브레이커를 둔다.
  return recs.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return preFounderExplicitRank(b) - preFounderExplicitRank(a);
  });
}

/** 예비창업자를 명시한 공고면 1, 아니면 0 (동점 정렬용) */
function preFounderExplicitRank(r: Recommendation): number {
  return r.matchedReasons.includes("예비창업자 대상 사업(명시)") ? 1 : 0;
}

/**
 * 회사 정보와 공고 해시태그가 겹치는 키워드를 뽑는다 (강조 표시·가점용).
 * 공고가 직접 단 주제 태그 중 회사의 업종·관심분야·특성·소개글과 맞닿는 것.
 */
function computeMatchedKeywords(
  company: CompanyProfile,
  program: Candidate["program"],
): string[] {
  const tags = program.hashtags ?? [];
  if (tags.length === 0) return [];

  const profileText =
    `${company.industry} ${company.interests.join(" ")} ${company.traits.join(" ")} ${company.description}`;
  const profileTokens = profileKeywords(company);

  const matched = tags.filter((tag) => {
    if (profileText.includes(tag)) return true; // 소개글 등에 태그가 그대로 등장
    return profileTokens.some(
      (tok) => tag.includes(tok) || tok.includes(tag),
    );
  });

  return Array.from(new Set(matched)).slice(0, 6);
}

/** 문자열을 매칭용 토큰으로 분해 ("농업/농식품" → ["농업","농식품"]). 1글자 토큰은 제외 */
function splitTokens(s: string): string[] {
  return s
    .split(/[\s,.;·/()]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
}

/** 회사 프로필에서 매칭에 쓸 키워드 집합을 추출 (복합 라벨은 토큰으로 분해) */
function profileKeywords(company: CompanyProfile): string[] {
  const raw = [
    ...splitTokens(company.industry),
    ...company.interests.flatMap(splitTokens),
    ...company.traits,
    ...splitTokens(company.description),
  ];
  return Array.from(new Set(raw.filter((w) => w.length >= 2)));
}

function programText(program: Candidate["program"]): string {
  return `${program.title} ${program.summary} ${program.supportContent} ${program.target ?? ""}`;
}

function countKeywordHits(keywords: string[], text: string): number {
  let hits = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) hits++;
  }
  return hits;
}

function clamp(n: number): number {
  if (Number.isNaN(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * 신청 시의성 점수 (0~10): 마감일까지 남은 기간으로 매긴다.
 *  여유(>14일) 10 · 보통(8~14일) 8 · 임박(0~7일) 6 · 상시/열린마감 7 · 마감 지남 2
 */
function scoreTimeliness(deadlineEnd?: string): number {
  if (!deadlineEnd) return 7; // 상시·"모집 완료시까지" 등 종료일 없음 → 신청 가능
  const end = new Date(`${deadlineEnd}T23:59:59`);
  if (Number.isNaN(end.getTime())) return 7;
  const days = Math.floor((end.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return 2; // 이미 마감
  if (days <= 7) return 6; // 임박
  if (days <= 14) return 8;
  return 10; // 여유
}
