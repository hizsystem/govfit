"use client";

import { useEffect, useState } from "react";
import {
  CATEGORIES,
  INDUSTRIES,
  REGIONS,
  TRAITS,
} from "@/lib/constants";
import type {
  Category,
  CompanyProfile,
  RecommendResponse,
  Recommendation,
} from "@/lib/types";
import { buildProposal, type ProposalFormat } from "@/lib/proposal";
import { buildNewsletter, type CategoryGroup } from "@/lib/newsletter";

const EMPTY_PROFILE: CompanyProfile = {
  name: "",
  preFounder: false,
  industry: "",
  region: "",
  businessAgeYears: 0,
  employeeCount: 0,
  annualRevenueEok: 0,
  traits: [],
  interests: [],
  description: "",
};

const BOOKMARK_KEY = "hiz_bookmarks";

export default function Home() {
  const [profile, setProfile] = useState<CompanyProfile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RecommendResponse | null>(null);
  // 추천을 받은 시점의 회사 정보 (사업계획서 초안에 사용)
  const [submittedProfile, setSubmittedProfile] =
    useState<CompanyProfile>(EMPTY_PROFILE);
  const [error, setError] = useState<string | null>(null);

  // 찜한 공고 (브라우저 localStorage에 저장 — 로그인 없이 이 브라우저에 보관)
  const [bookmarks, setBookmarks] = useState<Record<string, Recommendation>>({});
  // 화면 전환: 검색 / 관심공고 / 공고 사이트 모음 / 뉴스레터
  const [view, setView] = useState<
    "search" | "saved" | "sites" | "newsletter"
  >("search");

  useEffect(() => {
    // localStorage는 클라이언트에만 있으므로 마운트 후 읽어 하이드레이션 불일치를 피한다.
    // (이 setState는 그 목적상 의도된 것이라 set-state-in-effect 규칙을 끈다.)
    try {
      const raw = localStorage.getItem(BOOKMARK_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setBookmarks(JSON.parse(raw));
    } catch {
      /* 저장된 값이 깨졌으면 무시 */
    }
  }, []);

  function persist(next: Record<string, Recommendation>) {
    setBookmarks(next);
    try {
      localStorage.setItem(BOOKMARK_KEY, JSON.stringify(next));
    } catch {
      /* 용량 초과 등은 무시 */
    }
  }

  function toggleBookmark(rec: Recommendation) {
    const id = rec.program.id;
    const next = { ...bookmarks };
    if (next[id]) delete next[id];
    else next[id] = rec;
    persist(next);
  }

  const savedList = Object.values(bookmarks);

  function update<K extends keyof CompanyProfile>(
    key: K,
    value: CompanyProfile[K],
  ) {
    setProfile((p) => ({ ...p, [key]: value }));
  }

  // 예비창업자 모드 전환: 켜면 업력·근로자수·매출은 정보가 없으므로 0으로 둔다.
  function setPreFounder(value: boolean) {
    setProfile((p) =>
      value
        ? {
            ...p,
            preFounder: true,
            businessAgeYears: 0,
            employeeCount: 0,
            annualRevenueEok: 0,
          }
        : { ...p, preFounder: false },
    );
  }

  function toggleArray<T extends string>(
    key: "traits" | "interests",
    value: T,
  ) {
    setProfile((p) => {
      const arr = p[key] as string[];
      const next = arr.includes(value)
        ? arr.filter((v) => v !== value)
        : [...arr, value];
      return { ...p, [key]: next };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!profile.industry || !profile.region) {
      setError("업종과 지역은 필수 선택입니다.");
      return;
    }
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "추천 요청에 실패했습니다.");
      }
      setResult((await res.json()) as RecommendResponse);
      setSubmittedProfile(profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <nav className="sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur dark:border-gray-800 dark:bg-gray-900/80">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => setView("search")}
            className="flex items-center gap-2"
            aria-label="홈"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Brand Rise 로고"
              className="h-9 w-9 rounded-full object-cover"
            />
            <span className="text-lg font-extrabold tracking-tight text-gray-900 dark:text-gray-100">
              Brand Rise
            </span>
          </button>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() =>
                setView((v) => (v === "newsletter" ? "search" : "newsletter"))
              }
              className={`shrink-0 rounded-xl px-2.5 py-2 text-xs font-semibold transition sm:text-sm ${
                view === "newsletter"
                  ? "bg-blue-600 text-white"
                  : "border border-gray-300 bg-white text-gray-700 hover:border-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              }`}
            >
              📰 뉴스레터 구독
            </button>
            <button
              type="button"
              onClick={() => setView((v) => (v === "sites" ? "search" : "sites"))}
              className={`shrink-0 rounded-xl px-2.5 py-2 text-xs font-semibold transition sm:text-sm ${
                view === "sites"
                  ? "bg-blue-600 text-white"
                  : "border border-gray-300 bg-white text-gray-700 hover:border-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              }`}
            >
              🔗 공고 사이트 모음
            </button>
            <button
              type="button"
              onClick={() => setView((v) => (v === "saved" ? "search" : "saved"))}
              className={`shrink-0 rounded-xl px-2.5 py-2 text-xs font-semibold transition sm:text-sm ${
                view === "saved"
                  ? "bg-blue-600 text-white"
                  : "border border-gray-300 bg-white text-gray-700 hover:border-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              }`}
            >
              🔖 관심공고 {savedList.length}
            </button>
          </div>
        </div>
      </nav>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        <header className="mb-8 overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-white p-6 sm:p-8 dark:border-gray-800 dark:from-blue-950/30 dark:via-gray-900 dark:to-gray-900">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl dark:text-gray-100">
            Brand Rise <span className="text-blue-600">정부지원사업 추천</span>
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            회사 정보를 입력하면 조건에 맞는 지원사업을 골라 AI가 적합도를
            매겨드려요.
          </p>
        </header>

      {view === "newsletter" ? (
        <NewsletterView />
      ) : view === "sites" ? (
        <SitesView />
      ) : view === "saved" ? (
        <SavedView
          savedList={savedList}
          profile={submittedProfile}
          isSaved={(id) => !!bookmarks[id]}
          onToggleSave={toggleBookmark}
        />
      ) : (
        <>
      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8 dark:border-gray-800 dark:bg-gray-900"
      >
        <Field label="창업 단계 *">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setPreFounder(false)}
              className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${
                !profile.preFounder
                  ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                  : "border-gray-300 bg-white text-gray-600 hover:border-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
              }`}
            >
              🏢 이미 사업자가 있어요
              <span className="mt-0.5 block text-xs font-normal opacity-70">
                업력·근로자수·매출로 더 정확히 매칭
              </span>
            </button>
            <button
              type="button"
              onClick={() => setPreFounder(true)}
              className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${
                profile.preFounder
                  ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                  : "border-gray-300 bg-white text-gray-600 hover:border-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
              }`}
            >
              🌱 예비창업자예요
              <span className="mt-0.5 block text-xs font-normal opacity-70">
                사업자등록 전 — 창업 단계 지원사업 위주로 추천
              </span>
            </button>
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="회사명 (선택)">
            <input
              type="text"
              value={profile.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="예: 주식회사 핏테크"
              className={inputCls}
            />
          </Field>

          <Field label={profile.preFounder ? "창업(예정) 분야 *" : "업종 *"}>
            <select
              value={profile.industry}
              onChange={(e) => update("industry", e.target.value)}
              className={inputCls}
            >
              <option value="">선택하세요</option>
              {INDUSTRIES.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </Field>

          <Field label="지역 (시·도) *">
            <select
              value={profile.region}
              onChange={(e) => update("region", e.target.value)}
              className={inputCls}
            >
              <option value="">선택하세요</option>
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>

          {!profile.preFounder && (
            <>
              <Field label="업력 (년)">
                <input
                  type="number"
                  min={0}
                  value={profile.businessAgeYears || ""}
                  onChange={(e) =>
                    update("businessAgeYears", Number(e.target.value) || 0)
                  }
                  placeholder="예: 2"
                  className={inputCls}
                />
              </Field>

              <Field label="근로자 수 (명)">
                <input
                  type="number"
                  min={0}
                  value={profile.employeeCount || ""}
                  onChange={(e) =>
                    update("employeeCount", Number(e.target.value) || 0)
                  }
                  placeholder="예: 8"
                  className={inputCls}
                />
              </Field>

              <Field label="연매출 (억원)">
                <input
                  type="number"
                  min={0}
                  value={profile.annualRevenueEok || ""}
                  onChange={(e) =>
                    update("annualRevenueEok", Number(e.target.value) || 0)
                  }
                  placeholder="예: 5"
                  className={inputCls}
                />
              </Field>
            </>
          )}
        </div>

        {profile.preFounder && (
          <p className="rounded-lg bg-emerald-50 px-4 py-3 text-xs leading-relaxed text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
            🌱 예비창업자 모드예요. 업력·근로자수·매출은 아직 없으니 입력하지 않아도
            돼요. 아래 <b>분야·지역·관심사·소개</b>만 채우면 예비창업패키지·청년창업
            등 <b>창업 단계 지원사업</b>을 우선 찾아드려요.
          </p>
        )}

        <Field label="회사 특성 (해당되는 것 모두)">
          <ChipGroup
            options={[...TRAITS]}
            selected={profile.traits}
            onToggle={(v) => toggleArray("traits", v)}
          />
        </Field>

        <Field label="관심 지원 분야 (해당되는 것 모두)">
          <ChipGroup
            options={CATEGORIES}
            selected={profile.interests}
            onToggle={(v) => toggleArray("interests", v as Category)}
          />
        </Field>

        <Field
          label={
            profile.preFounder
              ? "창업 아이템 / 현재 준비 상황 / 필요한 지원 (AI가 적합도 판단에 활용)"
              : "회사 소개 / 현재 상황 / 필요한 지원 (AI가 적합도 판단에 활용)"
          }
        >
          <textarea
            value={profile.description}
            onChange={(e) => update("description", e.target.value)}
            rows={4}
            placeholder={
              profile.preFounder
                ? "예: 반려동물 헬스케어 앱을 창업하려는 예비창업자입니다. 현재 아이디어 구체화·시제품 단계이고, 초기 사업화 자금과 창업 교육·공간이 필요합니다."
                : "예: AI 기반 재고관리 SaaS를 운영하는 초기 스타트업입니다. 곧 일본 시장 진출을 준비 중이고, 개발 인력 채용과 R&D 자금이 필요합니다."
            }
            className={inputCls}
          />
        </Field>

        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/40">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-3.5 text-base font-bold text-white shadow-lg shadow-blue-600/20 transition hover:from-blue-700 hover:to-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "라이지가 찾는 중… 🔍" : "맞춤 지원사업 추천받기"}
        </button>
      </form>

      {loading && <LoadingExperience />}

      {result && !loading && (
        <Results
          result={result}
          profile={submittedProfile}
          isSaved={(id) => !!bookmarks[id]}
          onToggleSave={toggleBookmark}
        />
      )}

      <footer className="mt-12 border-t border-gray-200 pt-6 text-center text-xs leading-relaxed text-gray-400 dark:border-gray-800">
        ⚠️ 추천은 참고용입니다. 신청 자격·마감 등 정확한 내용은 각 공고
        상세(기업마당·K-Startup 등)에서 반드시 확인하세요.
      </footer>
        </>
      )}
      </main>
    </>
  );
}

// ---------------------------------------------------------------------------
// 로딩 경험 — 마스코트 '라이지' + 회전 안내문구
// ---------------------------------------------------------------------------

/** Brand Rise 마스코트 '라이지' — 무럭무럭 자라는 새싹 캐릭터 (인라인 SVG) */
function RiseMascot({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 132"
      className={className}
      role="img"
      aria-label="Brand Rise 마스코트 라이지"
    >
      <defs>
        <linearGradient id="riseBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
        <linearGradient id="riseLeaf" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4ade80" />
          <stop offset="100%" stopColor="#22c55e" />
        </linearGradient>
      </defs>

      {/* 바닥 그림자 */}
      <ellipse cx="60" cy="124" rx="27" ry="5" fill="#000" opacity="0.12" />

      {/* 새싹 (줄기 + 잎 2장) — 살랑살랑 */}
      <g className="rise-wiggle" style={{ transformOrigin: "60px 42px" }}>
        <path
          d="M60 46 V22"
          stroke="#16a34a"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path d="M60 32 C49 19 35 22 33 32 C44 42 56 40 60 32 Z" fill="url(#riseLeaf)" />
        <path d="M60 28 C71 13 87 16 89 28 C78 40 64 38 60 28 Z" fill="url(#riseLeaf)" />
      </g>

      {/* 팔 (만세 — 몸통 뒤에서 나옴) */}
      <path
        d="M26 74 C14 66 16 54 25 56"
        stroke="url(#riseBody)"
        strokeWidth="9"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M94 74 C106 66 104 54 95 56"
        stroke="url(#riseBody)"
        strokeWidth="9"
        strokeLinecap="round"
        fill="none"
      />

      {/* 몸통 */}
      <ellipse cx="60" cy="80" rx="40" ry="42" fill="url(#riseBody)" />

      {/* 볼 */}
      <circle cx="38" cy="88" r="7" fill="#fb7185" opacity="0.5" />
      <circle cx="82" cy="88" r="7" fill="#fb7185" opacity="0.5" />

      {/* 눈 — 깜빡임 */}
      <g className="rise-blink" style={{ transformOrigin: "60px 76px" }}>
        <circle cx="47" cy="76" r="8.5" fill="#fff" />
        <circle cx="73" cy="76" r="8.5" fill="#fff" />
        <circle cx="48" cy="77" r="4.4" fill="#1e293b" />
        <circle cx="74" cy="77" r="4.4" fill="#1e293b" />
        <circle cx="46" cy="74.5" r="1.6" fill="#fff" />
        <circle cx="72" cy="74.5" r="1.6" fill="#fff" />
      </g>

      {/* 입 (방긋) */}
      <path
        d="M53 94 Q60 102 67 94"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />

      {/* 반짝임 */}
      <path
        d="M101 34 l1.8 4.8 4.8 1.8 -4.8 1.8 -1.8 4.8 -1.8 -4.8 -4.8 -1.8 4.8 -1.8 z"
        fill="#fbbf24"
      />
    </svg>
  );
}

/** 로딩 중 회전하는 안내 문구 — 라이지가 단계별로 무엇을 하는지 알려준다 */
const LOADING_MESSAGES = [
  "‘Brand Rise’가 당신의 회사에 가장 적합한 지원사업을 추리고 있어요 🔍",
  "전국 공공기관 공고를 샅샅이 살펴보는 중이에요 📚",
  "기업마당 · K-Startup · SBA 공고를 모으고 있어요 🗂️",
  "조건에 딱 맞는 지원사업만 골라내는 중이에요 ✨",
  "적합도를 점수로 매기는 중 — 거의 다 됐어요! 🎯",
];

function LoadingExperience() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(
      () => setIdx((i) => (i + 1) % LOADING_MESSAGES.length),
      2600,
    );
    return () => clearInterval(t);
  }, []);

  return (
    <section className="mt-10 flex flex-col items-center rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-white px-6 py-12 text-center shadow-sm dark:border-gray-800 dark:from-blue-950/30 dark:via-gray-900 dark:to-gray-900">
      <div className="rise-float">
        <RiseMascot className="h-32 w-32 drop-shadow-md" />
      </div>

      {/* key가 바뀔 때마다 rise-pop 애니메이션 재생 */}
      <p
        key={idx}
        className="rise-pop mt-6 max-w-md text-base font-semibold leading-relaxed text-gray-800 dark:text-gray-100"
      >
        {LOADING_MESSAGES[idx]}
      </p>
      <p className="mt-2 text-xs text-gray-400">
        라이지가 열심히 찾는 중이에요. 길어도 15초면 끝나요 ☕
      </p>

      {/* 진행 점 — 현재 단계 강조 */}
      <div className="mt-5 flex gap-1.5">
        {LOADING_MESSAGES.map((_, i) => (
          <span
            key={i}
            className={`h-2 rounded-full transition-all duration-300 ${
              i === idx
                ? "w-6 bg-blue-600"
                : "w-2 bg-blue-200 dark:bg-gray-700"
            }`}
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 결과 표시
// ---------------------------------------------------------------------------

type SortKey = "score" | "deadlineAsc" | "deadlineDesc";

function Results({
  result,
  profile,
  isSaved,
  onToggleSave,
}: {
  result: RecommendResponse;
  profile: CompanyProfile;
  isSaved: (id: string) => boolean;
  onToggleSave: (rec: Recommendation) => void;
}) {
  const { recommendations, aiUsed, dataSource, notice } = result;
  const isLive = dataSource === "bizinfo";
  const [tab, setTab] = useState<"top" | "all">("top");
  const [sort, setSort] = useState<SortKey>("score");
  const [page, setPage] = useState(1);
  const PER_PAGE = 15;

  // 추천 5선 = 적합도 상위 5개, 전체 = 조건부합 전부. 둘 다 선택한 기준으로 정렬.
  const baseList =
    tab === "top" ? recommendations.slice(0, 5) : recommendations;
  const list = sortRecs(baseList, sort);

  // 전체 탭만 15개씩 페이지네이션
  const totalPages =
    tab === "all" ? Math.max(1, Math.ceil(list.length / PER_PAGE)) : 1;
  const safePage = Math.min(page, totalPages);
  const pageList =
    tab === "all"
      ? list.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE)
      : list;

  function changeTab(t: "top" | "all") {
    setTab(t);
    setPage(1);
  }
  function changeSort(s: SortKey) {
    setSort(s);
    setPage(1);
  }

  return (
    <section className="mt-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold">
          추천 결과{" "}
          <span className="text-gray-400">
            (조건 부합 {recommendations.length}건)
          </span>
        </h2>
        <div className="flex flex-wrap gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              isLive
                ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
            }`}
          >
            {isLive ? "공공 API 실시간 데이터" : "내장 샘플 데이터"}
          </span>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              aiUsed
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40"
                : "bg-amber-50 text-amber-700 dark:bg-amber-950/40"
            }`}
          >
            {aiUsed ? "AI 매칭 적용" : "규칙 기반 매칭 (API 키 미설정)"}
          </span>
        </div>
      </div>

      {notice && (
        <p className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:bg-gray-800/60">
          {notice}
        </p>
      )}

      {/* 적합도 점수 기준 안내 */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs leading-relaxed dark:border-gray-800 dark:bg-gray-900">
        <span className="font-bold text-gray-700 dark:text-gray-200">
          적합도 점수 기준
        </span>
        <div className="mt-1.5 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-4">
          <span>
            <b className="text-red-600">80점 ↑ 지원 추천</b> — 지원해볼
            만합니다!
          </span>
          <span>
            <b className="text-blue-600">40점 ↑ 검토 권장</b> — 공고 확인 후
            고민해볼 만합니다
          </span>
          <span>
            <b className="text-gray-500">40점 미만 참고</b> — 조건을 더
            확인해보세요
          </span>
        </div>
      </div>

      {/* 탭: 추천 5선 / 전체 */}
      <div className="mb-3 flex gap-2">
        <TabButton active={tab === "top"} onClick={() => changeTab("top")}>
          ⭐ 추천 5선
        </TabButton>
        <TabButton active={tab === "all"} onClick={() => changeTab("all")}>
          전체 {recommendations.length}건
        </TabButton>
      </div>

      {/* 정렬: 두 탭 모두에서 사용 */}
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-gray-400">정렬</span>
        <select
          value={sort}
          onChange={(e) => changeSort(e.target.value as SortKey)}
          className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm outline-none dark:border-gray-700 dark:bg-gray-950"
        >
          <option value="score">적합도 높은순</option>
          <option value="deadlineAsc">마감 임박순 (적게 남은)</option>
          <option value="deadlineDesc">마감 여유순 (많이 남은)</option>
        </select>
        {tab === "all" && (
          <span className="ml-auto text-xs text-gray-400">
            {safePage} / {totalPages} 페이지
          </span>
        )}
      </div>

      <ul className="space-y-4">
        {pageList.map((rec, i) => (
          <RecCard
            key={rec.program.id}
            rec={rec}
            profile={profile}
            index={
              tab === "all" ? (safePage - 1) * PER_PAGE + i + 1 : i + 1
            }
            saved={isSaved(rec.program.id)}
            onToggleSave={() => onToggleSave(rec)}
          />
        ))}
      </ul>

      {tab === "all" && totalPages > 1 && (
        <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />
      )}
    </section>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  // 현재 페이지 주변 번호만 노출 (최대 5개 창)
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  const nums: number[] = [];
  for (let i = start; i <= end; i++) nums.push(i);

  const btn =
    "min-w-9 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-40";

  return (
    <div className="mt-5 flex items-center justify-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className={`${btn} bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300`}
      >
        ← 이전
      </button>
      {nums.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`${btn} ${
            n === page
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"
          }`}
        >
          {n}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className={`${btn} bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300`}
      >
        다음 →
      </button>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
        active
          ? "bg-blue-600 text-white"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"
      }`}
    >
      {children}
    </button>
  );
}

/** 정렬: 마감 정렬 시 상시/열린마감은 뒤로, 마감지난 건 맨 뒤로 */
function sortRecs(recs: Recommendation[], sort: SortKey): Recommendation[] {
  const arr = [...recs];
  if (sort === "score") return arr.sort((a, b) => b.score - a.score);

  const bucketed = arr.map((r) => {
    const diff = r.program.deadlineEnd ? ddayDiff(r.program.deadlineEnd) : null;
    // bucket: 0=진행중(마감 안 지남), 1=상시/열린마감, 2=마감 지남
    const bucket = diff === null ? 1 : diff < 0 ? 2 : 0;
    return { r, diff, bucket };
  });

  bucketed.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket - b.bucket;
    if (a.bucket !== 0) return b.r.score - a.r.score; // 진행중 아닌 것끼리는 적합도순
    const da = a.diff as number;
    const db = b.diff as number;
    return sort === "deadlineAsc" ? da - db : db - da;
  });

  return bucketed.map((x) => x.r);
}

// 정부지원사업 공고가 올라오는 주요 공공 사이트 (현재 연동: 기업마당. 추후 API 추가 예정)
const SITES: {
  name: string;
  org: string;
  desc: string;
  url: string;
  tag: string;
  connected?: boolean;
}[] = [
  { name: "기업마당", org: "중소벤처기업부", desc: "중소기업 지원사업 종합 포털", url: "https://www.bizinfo.go.kr", tag: "종합", connected: true },
  { name: "K-Startup", org: "창업진흥원", desc: "창업지원포털 — 예비·초기 창업 지원사업", url: "https://www.k-startup.go.kr", tag: "창업", connected: true },
  { name: "중소벤처기업진흥공단", org: "중진공", desc: "정책자금·융자·연수 등 성장 지원", url: "https://www.kosmes.or.kr", tag: "자금" },
  { name: "소상공인마당", org: "소상공인시장진흥공단", desc: "소상공인 지원사업·정책자금", url: "https://www.semas.or.kr", tag: "소상공인" },
  { name: "워크넷·고용24", org: "고용노동부", desc: "고용·인력·일자리 지원금", url: "https://www.work.go.kr", tag: "고용" },
  { name: "수출바우처", org: "중기부·KOTRA", desc: "해외마케팅·수출 바우처 지원", url: "https://www.exportvoucher.com", tag: "수출" },
  { name: "SMTECH", org: "중소기업기술정보진흥원", desc: "중소기업 R&D·기술개발 지원", url: "https://www.smtech.go.kr", tag: "R&D" },
  { name: "스마트공장 사업관리시스템", org: "스마트제조혁신추진단", desc: "제조 스마트공장 구축 지원", url: "https://www.smart-factory.kr", tag: "제조" },
  { name: "한국콘텐츠진흥원", org: "문화체육관광부", desc: "게임·영상·웹툰 등 콘텐츠 지원", url: "https://www.kocca.kr", tag: "콘텐츠" },
  { name: "aT 농식품", org: "한국농수산식품유통공사", desc: "농식품 기업 사업화·수출 지원", url: "https://www.at.or.kr", tag: "농식품" },
  { name: "중소기업중앙회", org: "중소기업중앙회", desc: "경영·판로·공동사업 지원", url: "https://www.kbiz.or.kr", tag: "경영" },
  { name: "공공데이터포털", org: "행정안전부", desc: "정부 공공데이터·OpenAPI 제공", url: "https://www.data.go.kr", tag: "데이터" },
];

interface NewsletterData {
  label: string;
  groups: CategoryGroup[];
  dataSource: string;
}

function NewsletterView() {
  const [data, setData] = useState<NewsletterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/newsletter")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((d: NewsletterData) => setData(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const text = data ? buildNewsletter(data.groups, data.label) : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 무시 */
    }
  }

  function download() {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `BrandRise_뉴스레터_${data?.label ?? ""}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section>
      <h2 className="text-xl font-bold">📰 이번 주 분야별 주목 지원사업</h2>
      {data && (
        <p className="mt-1 text-sm font-semibold text-blue-600">{data.label}</p>
      )}
      <p className="mb-4 mt-1 text-sm text-gray-500 dark:text-gray-400">
        분야별로 규모가 크고 주목도 높은 지원사업을 5개씩 모았어요. 메일 도구에
        붙여 뉴스레터로 발송할 수도 있어요.
      </p>

      {loading && (
        <p className="rounded-xl bg-gray-50 px-4 py-10 text-center text-sm text-gray-500 dark:bg-gray-800/60">
          이번 주 뉴스레터를 불러오는 중…
        </p>
      )}
      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-6 text-center text-sm text-red-600 dark:bg-red-950/40">
          뉴스레터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.
        </p>
      )}

      {data && (
        <>
          <div className="space-y-8">
            {data.groups.map((g) => (
              <div key={g.category}>
                <h3 className="mb-3 flex items-center gap-2 border-b border-gray-200 pb-2 text-base font-bold text-gray-800 dark:border-gray-800 dark:text-gray-100">
                  <span className="rounded-md bg-blue-600 px-2 py-0.5 text-xs text-white">
                    {g.category}
                  </span>
                  <span className="text-sm font-normal text-gray-400">
                    {g.programs.length}건
                  </span>
                </h3>
                <ol className="space-y-3">
                  {g.programs.map((p, i) => (
                    <li
                      key={p.id}
                      className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
                    >
                      <div className="flex items-start gap-3">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-blue-600 text-sm font-bold text-white">
                          {i + 1}
                        </span>
                        <div className="min-w-0">
                          {p.subCategory && (
                            <span className="inline-block rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950/40">
                              {p.subCategory}
                            </span>
                          )}
                          <h3 className="mt-1 font-semibold">{p.title}</h3>
                          <p className="text-xs text-gray-400">{p.agency}</p>
                        </div>
                      </div>
                      <dl className="mt-3 grid grid-cols-1 gap-1.5 text-sm">
                        <KV icon="🗓" label="신청기간" value={p.deadline} />
                        {p.supportSummary && (
                          <KV
                            icon="🎁"
                            label="지원내용"
                            value={p.supportSummary}
                          />
                        )}
                      </dl>
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-block text-sm font-medium text-blue-600 hover:underline"
                      >
                        공고 상세 보기 →
                      </a>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-4 dark:border-gray-800">
            <button
              type="button"
              onClick={copy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              {copied ? "복사됨 ✓" : "뉴스레터 복사"}
            </button>
            <button
              type="button"
              onClick={download}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              .md 다운로드
            </button>
            <span className="text-xs text-gray-400">
              스티비·메일침프 등 메일 도구에 붙여 발송하세요
            </span>
          </div>
        </>
      )}
    </section>
  );
}

function SitesView() {
  return (
    <section>
      <h2 className="mb-1 text-xl font-bold">🔗 정부지원사업 공고 사이트 모음</h2>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        지원사업 공고가 올라오는 주요 공공 사이트예요. 카드를 누르면 해당
        사이트로 바로 이동합니다.
      </p>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SITES.map((s) => (
          <li key={s.url}>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
            >
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950/40">
                  {s.tag}
                </span>
                {s.connected && (
                  <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                    연동 중
                  </span>
                )}
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                {s.name}
              </h3>
              <p className="text-xs text-gray-400">{s.org}</p>
              <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400">
                {s.desc}
              </p>
              <span className="mt-3 inline-block text-sm font-medium text-blue-600 hover:underline">
                바로가기 →
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-center text-xs text-gray-400">
        ※ 현재 <b>기업마당 · K-Startup</b> 공고를 실시간 연동 중이며, 다른
        사이트는 순차 연동 예정입니다.
      </p>
    </section>
  );
}

function SavedView({
  savedList,
  profile,
  isSaved,
  onToggleSave,
}: {
  savedList: Recommendation[];
  profile: CompanyProfile;
  isSaved: (id: string) => boolean;
  onToggleSave: (rec: Recommendation) => void;
}) {
  return (
    <section>
      <h2 className="mb-4 text-xl font-bold">
        🔖 관심공고{" "}
        <span className="text-gray-400">({savedList.length}건)</span>
      </h2>
      {savedList.length === 0 ? (
        <p className="rounded-xl bg-gray-50 px-4 py-10 text-center text-sm text-gray-500 dark:bg-gray-800/60">
          아직 담은 관심공고가 없어요.
          <br />
          추천 결과에서 <b>관심공고 담기</b>를 눌러 모아보세요.
        </p>
      ) : (
        <ul className="space-y-4">
          {savedList.map((rec, i) => (
            <RecCard
              key={rec.program.id}
              rec={rec}
              profile={profile}
              index={i + 1}
              saved={isSaved(rec.program.id)}
              onToggleSave={() => onToggleSave(rec)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function RecCard({
  rec,
  profile,
  index,
  saved,
  onToggleSave,
}: {
  rec: Recommendation;
  profile: CompanyProfile;
  index: number;
  saved: boolean;
  onToggleSave: () => void;
}) {
  const { program, score, reason, matchedReasons, matchedKeywords } = rec;
  const [showFull, setShowFull] = useState(false);
  const [showProposal, setShowProposal] = useState(false);
  const dday = program.deadlineEnd ? computeDday(program.deadlineEnd) : null;
  const fieldLabel = program.subCategory
    ? `${program.category} › ${program.subCategory}`
    : program.category;
  const period = formatPeriod(program);
  const contactOrg = program.contactOrg ?? "주관기관";
  // 전문이 요약과 실제로 다를 때만 "전문 보기" 제공
  const hasFull =
    !!program.supportContent && program.supportContent !== program.summary;
  // 부합 키워드와 겹치지 않는 나머지 주제 태그 (참고용으로 소수만)
  const otherTags = (program.hashtags ?? [])
    .filter((t) => !matchedKeywords.includes(t))
    .slice(0, 5);

  return (
    <li className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-blue-200 hover:shadow-md dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-gray-900 px-1.5 text-xs font-bold text-white dark:bg-gray-100 dark:text-gray-900">
              {index}
            </span>
            <span className="inline-block rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950/40">
              {fieldLabel}
            </span>
            {program.source && (
              <span className="inline-block rounded-md border border-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 dark:border-gray-700">
                {program.source}
              </span>
            )}
          </div>
          <h3 className="mt-1.5 text-lg font-semibold">{program.title}</h3>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            type="button"
            onClick={onToggleSave}
            aria-pressed={saved}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition ${
              saved
                ? "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"
                : "text-gray-400 hover:text-blue-600"
            }`}
          >
            <BookmarkIcon filled={saved} />
            관심
          </button>
          {dday && <DdayBadge dday={dday} />}
          <ScoreBadge score={score} />
        </div>
      </div>

      {/* 부합 키워드 — 회사 정보와 공고가 겹치는 지점 */}
      {matchedKeywords.length > 0 && (
        <div className="mt-3">
          <span className="mr-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            🎯 우리 회사와 맞닿는 키워드
          </span>
          <span className="inline-flex flex-wrap gap-1.5 align-middle">
            {matchedKeywords.map((k) => (
              <span
                key={k}
                className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
              >
                {k}
              </span>
            ))}
          </span>
        </div>
      )}

      {/* 지역 · 수행기관 · 사업목적 + 전문 */}
      <div className="mt-3 rounded-lg bg-gray-50 px-3.5 py-3 dark:bg-gray-800/50">
        <dl className="space-y-1.5">
          <KV icon="📍" label="지역" value={regionLabel(program.regions)} />
          <KV icon="🏛" label="수행기관" value={program.agency} />
          <KV
            icon="🎯"
            label="사업목적"
            value={program.purpose || program.summary}
            clamp
          />
          {program.supportSummary && (
            <KV icon="🎁" label="지원내용" value={program.supportSummary} />
          )}
          {program.eligibility && (
            <KV icon="📋" label="자격요건" value={program.eligibility} />
          )}
        </dl>
        {hasFull && (
          <>
            {showFull && (
              <p className="mt-2 whitespace-pre-line border-t border-gray-200 pt-2 text-sm leading-relaxed text-gray-600 dark:border-gray-700 dark:text-gray-400">
                {program.supportContent}
              </p>
            )}
            <button
              type="button"
              onClick={() => setShowFull((v) => !v)}
              className="mt-1.5 text-xs font-medium text-blue-600 hover:underline"
            >
              {showFull ? "사업개요 접기 ▴" : "사업개요 전문 보기 ▾"}
            </button>
          </>
        )}
      </div>

      <div className="mt-3 rounded-lg bg-blue-50/60 px-3 py-2 text-sm text-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
        <span className="font-medium">추천 이유 · </span>
        {reason}
      </div>

      {/* 점수 산정 근거 */}
      <div className="mt-3">
        <span className="text-xs text-gray-400">점수 산정 근거 · </span>
        <span className="inline-flex flex-wrap gap-1.5 align-middle">
          {matchedReasons.map((m, i) => (
            <span
              key={`r${i}`}
              className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300"
            >
              ✓ {m}
            </span>
          ))}
          {matchedKeywords.length > 0 && (
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              ✓ 키워드 {matchedKeywords.length}개 부합
            </span>
          )}
          {noMatchSignals(matchedReasons, matchedKeywords) && (
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-500 dark:bg-gray-800">
              기본 신청 자격 충족
            </span>
          )}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-100 pt-3 text-sm dark:border-gray-800">
        <div className="col-span-2">
          <Info label="신청 기간" value={period} />
        </div>
        {program.applyMethod && (
          <Info label="신청 방법" value={program.applyMethod} />
        )}
        {/* 문의처: 주관기관(전화번호) 형식 */}
        {(program.contactPhone || program.contact) && (
          <div className="col-span-2">
            <Info
              label="📞 문의처"
              value={
                program.contactPhone
                  ? `${contactOrg} (${program.contactPhone})`
                  : program.contact!
              }
            />
          </div>
        )}
        {program.contactEmail && (
          <div className="col-span-2 text-sm">
            <dt className="text-xs text-gray-400">✉️ 이메일</dt>
            <dd className="font-medium text-gray-800 dark:text-gray-200">
              {contactOrg} (
              <a
                href={`mailto:${program.contactEmail}`}
                className="text-blue-600 hover:underline"
              >
                {program.contactEmail}
              </a>
              )
            </dd>
          </div>
        )}
      </dl>

      {otherTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {otherTags.map((t) => (
            <span key={t} className="text-xs text-gray-400">
              #{t}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => setShowProposal(true)}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-blue-600 px-5 py-3 text-sm font-bold text-blue-700 transition hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/40"
          >
            📝 사업계획서 초안
          </button>
          <a
            href={program.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
          >
            📄 공고 상세 보기 <span aria-hidden>↗</span>
          </a>
        </div>
        <p className="mt-2 text-center text-xs text-gray-400">
          {program.attachmentName
            ? "자격·평가기준·지원금액 등 상세는 첨부 공고문에서 확인하세요"
            : "자격·평가기준 등 상세는 공고에서 확인하세요"}
        </p>
      </div>

      {showProposal && (
        <ProposalModal
          rec={rec}
          profile={profile}
          onClose={() => setShowProposal(false)}
        />
      )}
    </li>
  );
}

function ProposalModal({
  rec,
  profile,
  onClose,
}: {
  rec: Recommendation;
  profile: CompanyProfile;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<ProposalFormat>("doc");
  const [copied, setCopied] = useState(false);
  const today = new Date().toLocaleDateString("ko-KR");
  const text = buildProposal(rec, profile, format, today);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 클립보드 권한 없으면 무시 */
    }
  }

  function download() {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = rec.program.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
    a.href = url;
    a.download = `사업계획서_${safe}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 p-4 dark:border-gray-800">
          <div className="min-w-0">
            <h3 className="font-bold">📝 사업계획서 초안</h3>
            <p className="truncate text-xs text-gray-400">{rec.program.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            ✕
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 pt-3">
          <FormatTab active={format === "doc"} onClick={() => setFormat("doc")}>
            📄 문서용 (노션·워드)
          </FormatTab>
          <FormatTab active={format === "marp"} onClick={() => setFormat("marp")}>
            📊 발표용 (Marp 슬라이드)
          </FormatTab>
        </div>

        <textarea
          readOnly
          value={text}
          className="m-4 min-h-0 flex-1 resize-none rounded-lg border border-gray-200 bg-gray-50 p-4 font-mono text-sm leading-relaxed text-gray-700 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300"
        />

        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 p-4 dark:border-gray-800">
          <button
            type="button"
            onClick={copy}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            {copied ? "복사됨 ✓" : "복사하기"}
          </button>
          <button
            type="button"
            onClick={download}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            .md 다운로드
          </button>
          <span className="text-xs text-gray-400">
            {format === "marp"
              ? "Marp(marp.app)에 붙여 PDF·슬라이드로 변환하세요"
              : "노션/워드/한글에 붙여넣고 [ ] 부분을 채우세요"}
          </span>
        </div>
      </div>
    </div>
  );
}

function FormatTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? "bg-blue-600 text-white"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"
      }`}
    >
      {children}
    </button>
  );
}

/** 매칭 이유·키워드가 하나도 없으면 "기본 자격 충족"만 표시하기 위한 판단 */
function noMatchSignals(reasons: string[], keywords: string[]): boolean {
  return reasons.length === 0 && keywords.length === 0;
}

/** 지역 표시: 지정 지역이 없으면(전국 대상) "전국" */
function regionLabel(regions: string[]): string {
  return regions.length > 0 ? regions.join(" · ") : "전국";
}

/** 아이콘 + 라벨 + 값 한 줄 (지역·수행기관·목적 표시용) */
function KV({
  icon,
  label,
  value,
  clamp,
}: {
  icon: string;
  label: string;
  value: string;
  clamp?: boolean;
}) {
  return (
    <div className="flex gap-2 text-sm">
      <dt className="w-24 shrink-0 whitespace-nowrap font-medium text-gray-400">
        {icon} {label}
      </dt>
      <dd
        className={`min-w-0 flex-1 break-words text-gray-700 dark:text-gray-300 ${
          clamp ? "line-clamp-2" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/** 신청기간 표시 문자열: 종료일이 열려있으면(모집 완료시) 그렇게 표기 */
function formatPeriod(program: Recommendation["program"]): string {
  if (program.deadlineStart && !program.deadlineEnd) {
    return `${program.deadlineStart} ~ 모집 완료 시까지`;
  }
  return program.deadline;
}

interface Dday {
  label: string;
  tone: "urgent" | "soon" | "normal" | "closed";
}

/** 마감일(YYYY-MM-DD)과 오늘의 일수 차 (사용자 로컬 날짜 기준). 파싱 불가 시 null */
function ddayDiff(endDate: string): number | null {
  const end = new Date(`${endDate}T23:59:59`);
  if (Number.isNaN(end.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function computeDday(endDate: string): Dday | null {
  const diff = ddayDiff(endDate);
  if (diff === null) return null;
  if (diff < 0) return { label: "마감", tone: "closed" };
  if (diff === 0) return { label: "오늘 마감", tone: "urgent" };
  if (diff <= 7) return { label: `D-${diff}`, tone: "urgent" };
  if (diff <= 14) return { label: `D-${diff}`, tone: "soon" };
  return { label: `D-${diff}`, tone: "normal" };
}

function DdayBadge({ dday }: { dday: Dday }) {
  const cls = {
    urgent: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
    soon: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
    normal: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    closed: "bg-gray-100 text-gray-400 dark:bg-gray-800",
  }[dday.tone];
  return (
    <span className={`rounded-lg px-3 py-1.5 text-base font-extrabold ${cls}`}>
      {dday.label}
    </span>
  );
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4-7 4V4.5a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

/** 적합도 점수 → 등급/안내 (80↑ 지원 추천, 40↑ 검토 권장, 그 외 참고) */
function scoreGrade(score: number) {
  if (score >= 80)
    return {
      label: "지원 추천",
      sentence: "지원해볼 만합니다!",
      numColor: "text-red-600",
      pill: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
    };
  if (score >= 40)
    return {
      label: "검토 권장",
      sentence: "공고 확인 후 고민해볼 만합니다",
      numColor: "text-blue-600",
      pill: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
    };
  return {
    label: "참고",
    sentence: "조건을 더 확인해보세요",
    numColor: "text-gray-500",
    pill: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  };
}

function ScoreBadge({ score }: { score: number }) {
  const g = scoreGrade(score);
  return (
    <div className="flex shrink-0 flex-col items-end">
      <div className={`text-2xl font-bold leading-none ${g.numColor}`}>
        {score}
      </div>
      <div className="mb-1 text-[10px] text-gray-400">적합도</div>
      <span
        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${g.pill}`}
      >
        {g.label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 작은 UI 조각들
// ---------------------------------------------------------------------------

const inputCls =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none transition hover:border-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-950 dark:focus:ring-blue-900/40";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </span>
      {children}
    </label>
  );
}

function ChipGroup({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${
              active
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-gray-300 bg-white text-gray-700 hover:border-blue-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300"
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="font-medium text-gray-800 dark:text-gray-200">{value}</dd>
    </div>
  );
}
