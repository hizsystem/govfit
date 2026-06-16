"use client";

import { useEffect, useMemo, useState } from "react";
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
import { track, getSessionId } from "@/lib/track";

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
const MYPROFILE_KEY = "hiz_myprofile";

/** 마이페이지 프로필 (디지털 명함·인사말에 사용. 로그인 없이 이 브라우저에 저장) */
interface MyProfile {
  name: string; // 이름
  company: string; // 회사명/상호
  title: string; // 직책
  phone: string;
  email: string;
  website: string;
  tagline: string; // 한 줄 소개
  industry: string;
  region: string;
}

const EMPTY_MYPROFILE: MyProfile = {
  name: "",
  company: "",
  title: "",
  phone: "",
  email: "",
  website: "",
  tagline: "",
  industry: "",
  region: "",
};

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
  // 마이페이지 프로필 (디지털 명함 등)
  const [myProfile, setMyProfile] = useState<MyProfile>(EMPTY_MYPROFILE);
  // 화면 전환: 검색 / 관심공고 / 공고 사이트 모음 / 뉴스레터 / 마이페이지 / 소개
  const [view, setView] = useState<
    "search" | "saved" | "sites" | "newsletter" | "mypage" | "intro"
  >("search");
  // 관심공고 화면 진입 시 초기 보기 모드 (마이페이지 타일에서 캘린더/목록 지정)
  const [savedMode, setSavedMode] = useState<"calendar" | "list">("calendar");
  // 연동된 지원사업 총 개수/소스 수 (소개·헤더에 표시)
  const [stats, setStats] = useState<{ total: number; sourceCount: number } | null>(
    null,
  );

  useEffect(() => {
    // localStorage는 클라이언트에만 있으므로 마운트 후 읽어 하이드레이션 불일치를 피한다.
    // (이 setState는 그 목적상 의도된 것이라 set-state-in-effect 규칙을 끈다.)
    try {
      const raw = localStorage.getItem(BOOKMARK_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setBookmarks(JSON.parse(raw));
      const rawProfile = localStorage.getItem(MYPROFILE_KEY);
      if (rawProfile) setMyProfile({ ...EMPTY_MYPROFILE, ...JSON.parse(rawProfile) });
    } catch {
      /* 저장된 값이 깨졌으면 무시 */
    }
  }, []);

  // 연동 지원사업 총 개수 로드 (캐시된 /api/stats — 실패해도 무시)
  useEffect(() => {
    let alive = true;
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && typeof d.total === "number") {
          setStats({ total: d.total, sourceCount: d.sourceCount ?? 0 });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  function saveMyProfile(next: MyProfile) {
    setMyProfile(next);
    try {
      localStorage.setItem(MYPROFILE_KEY, JSON.stringify(next));
    } catch {
      /* 용량 초과 등은 무시 */
    }
  }

  function openSaved(mode: "calendar" | "list") {
    setSavedMode(mode);
    setView("saved");
  }

  // 방문 기록 + 체류시간: 마운트 시 page_view, 첫 이탈(탭 숨김/종료) 시 session_end(초)
  useEffect(() => {
    track("page_view");
    const start = Date.now();
    let sent = false;
    const end = () => {
      if (sent) return;
      sent = true;
      track("session_end", { value: Math.round((Date.now() - start) / 1000) });
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") end();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", end);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", end);
    };
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
    const adding = !next[id];
    if (next[id]) delete next[id];
    else next[id] = rec;
    persist(next);
    track("bookmark", {
      programId: id,
      programTitle: rec.program.title,
      value: adding ? "on" : "off",
    });
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
        body: JSON.stringify({ ...profile, sessionId: getSessionId() }),
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
            onClick={() => setView("intro")}
            className="flex items-center gap-2"
            aria-label="브랜드라이즈 소개"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Brand Rise 로고"
              className="h-9 w-9 rounded-lg object-cover"
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
              onClick={() => openSaved("calendar")}
              className={`shrink-0 rounded-xl px-2.5 py-2 text-xs font-semibold transition sm:text-sm ${
                view === "saved"
                  ? "bg-blue-600 text-white"
                  : "border border-gray-300 bg-white text-gray-700 hover:border-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              }`}
            >
              🔖 관심공고 {savedList.length}
            </button>
            <button
              type="button"
              onClick={() => setView((v) => (v === "mypage" ? "search" : "mypage"))}
              className={`shrink-0 rounded-xl px-2.5 py-2 text-xs font-semibold transition sm:text-sm ${
                view === "mypage"
                  ? "bg-blue-600 text-white"
                  : "border border-gray-300 bg-white text-gray-700 hover:border-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              }`}
            >
              👤 마이페이지
            </button>
          </div>
        </div>
      </nav>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        {view !== "mypage" && view !== "intro" && (
        <header className="mb-8 overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-white p-6 sm:p-8 dark:border-gray-800 dark:from-blue-950/30 dark:via-gray-900 dark:to-gray-900">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl dark:text-gray-100">
            Brand Rise <span className="text-blue-600">정부지원사업 추천</span>
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            회사 정보를 입력하면 조건에 맞는 지원사업을 골라 AI가 적합도를
            매겨드려요.
          </p>
          {stats && stats.total > 0 && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-blue-600/10 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-400/10 dark:text-blue-300">
              📡 현재 <b>{stats.total.toLocaleString()}개</b>의 지원사업 실시간 연동 중
            </p>
          )}
        </header>
        )}

      {view === "intro" ? (
        <IntroView
          stats={stats}
          onStart={() => setView("search")}
          onOpenMypage={() => setView("mypage")}
          onOpenNewsletter={() => setView("newsletter")}
        />
      ) : view === "mypage" ? (
        <MyPageView
          myProfile={myProfile}
          onSaveProfile={saveMyProfile}
          savedList={savedList}
          searchProfile={submittedProfile}
          onOpenSaved={openSaved}
          onGoSearch={() => setView("search")}
        />
      ) : view === "newsletter" ? (
        <NewsletterView />
      ) : view === "sites" ? (
        <SitesView />
      ) : view === "saved" ? (
        <SavedView
          savedList={savedList}
          profile={submittedProfile}
          initialMode={savedMode}
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

        <Field label="관심 지원 분야 (해당되는 것 모두 · AI가 적합도 판단에 활용)">
          <ChipGroup
            options={CATEGORIES}
            selected={profile.interests}
            onToggle={(v) => toggleArray("interests", v as Category)}
          />
          <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs leading-relaxed text-gray-600 dark:bg-blue-950/30 dark:text-gray-400">
            💡 선택한 분야는 회사 소개처럼 <b>적합도 점수에 반영</b>돼요. 분야 밖에도
            잘 맞는 좋은 사업이 있을 수 있어, 놓치지 않도록 조건에 맞는 공고는 모두
            보여드립니다.
          </p>
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

/**
 * Brand Rise 마스코트 '라이지' — 새싹을 틔운 크림빛 캐릭터.
 * 돋보기로 회사에 맞는 지원사업을 찾는 모습. (인라인 SVG, 부드러운 음영)
 */
function RiseMascot({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 160 175"
      className={className}
      role="img"
      aria-label="Brand Rise 마스코트 라이지"
    >
      <defs>
        <radialGradient id="riseBody" cx="40%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#fffdf8" />
          <stop offset="58%" stopColor="#f5eede" />
          <stop offset="100%" stopColor="#e4d8c2" />
        </radialGradient>
        <linearGradient id="riseLeaf" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#86d36b" />
          <stop offset="100%" stopColor="#4fae3e" />
        </linearGradient>
        <linearGradient id="riseStem" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5cb85c" />
          <stop offset="100%" stopColor="#3f9e3f" />
        </linearGradient>
      </defs>

      {/* 바닥 그림자 */}
      <ellipse cx="80" cy="166" rx="40" ry="6" fill="#000" opacity="0.10" />

      {/* 새싹 — 살랑살랑 */}
      <g className="rise-wiggle" style={{ transformOrigin: "80px 56px" }}>
        <path d="M80 60 V32" stroke="url(#riseStem)" strokeWidth="5" strokeLinecap="round" />
        <path d="M80 44 C65 26 43 30 41 43 C56 56 74 54 80 44 Z" fill="url(#riseLeaf)" />
        <path d="M80 40 C95 22 118 26 120 40 C104 55 84 53 80 40 Z" fill="url(#riseLeaf)" />
        <path
          d="M80 41 C90 33 104 33 113 40"
          stroke="#3f9e3f"
          strokeWidth="1.5"
          fill="none"
          opacity="0.5"
        />
      </g>

      {/* 오른팔 */}
      <ellipse
        cx="120"
        cy="120"
        rx="11"
        ry="13"
        fill="url(#riseBody)"
        transform="rotate(20 120 120)"
      />

      {/* 몸통 + 하이라이트 */}
      <ellipse cx="80" cy="108" rx="47" ry="49" fill="url(#riseBody)" />
      <ellipse cx="66" cy="94" rx="24" ry="24" fill="#ffffff" opacity="0.30" />

      {/* 볼 */}
      <circle cx="50" cy="116" r="8" fill="#f9a8b4" opacity="0.55" />
      <circle cx="106" cy="116" r="8" fill="#f9a8b4" opacity="0.55" />

      {/* 윙크 (오른쪽 눈) */}
      <path
        d="M96 106 Q102 100 108 106"
        stroke="#3f3a33"
        strokeWidth="3.2"
        strokeLinecap="round"
        fill="none"
      />

      {/* 입 */}
      <path
        d="M74 120 Q80 127 86 120"
        stroke="#7a5c3e"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />

      {/* 왼쪽 눈 (돋보기 안, 확대) — 깜빡임 */}
      <g className="rise-blink" style={{ transformOrigin: "60px 104px" }}>
        <circle cx="60" cy="104" r="11" fill="#ffffff" />
        <circle cx="61" cy="105" r="6.6" fill="#2b2622" />
        <circle cx="58" cy="101" r="2.4" fill="#ffffff" />
      </g>

      {/* 돋보기 */}
      <line x1="46" y1="120" x2="30" y2="138" stroke="#8b7fd6" strokeWidth="8" strokeLinecap="round" />
      <circle cx="60" cy="104" r="21" fill="#bfe3f5" opacity="0.22" />
      <circle cx="60" cy="104" r="21" fill="none" stroke="#8b7fd6" strokeWidth="6" />
      <circle cx="60" cy="104" r="21" fill="none" stroke="#cdc4f4" strokeWidth="2" />

      {/* 왼손 (손잡이 잡음) */}
      <circle cx="30" cy="138" r="9" fill="url(#riseBody)" />
    </svg>
  );
}

/** 로딩 단계 — 라이지가 단계별로 무엇을 하는지 (진행바와 동기화) */
const LOADING_STEPS = [
  { icon: "🔍", title: "정보 수집 중", sub: "회사 정보를 분석하고 있어요" },
  { icon: "📚", title: "데이터 분석 중", sub: "관련 지원사업을 분석 중이에요" },
  { icon: "💻", title: "조건 매칭 중", sub: "우리 회사에 맞는지 확인 중!" },
  { icon: "📋", title: "추천 선별 중", sub: "딱 맞는 지원사업을 골라요" },
  { icon: "🎉", title: "추천 완료!", sub: "최적의 지원사업을 찾았어요" },
] as const;

function LoadingExperience() {
  // 실제 소요 시간을 알 수 없어, 95%까지 점점 느려지게 차오르는 시뮬레이션
  // 진행바를 쓴다. 응답이 오면 이 컴포넌트가 언마운트되며 결과로 전환된다.
  const [progress, setProgress] = useState(8);

  useEffect(() => {
    const t = setInterval(() => {
      setProgress((p) => (p >= 95 ? 95 : p + Math.max(0.4, (95 - p) * 0.035)));
    }, 180);
    return () => clearInterval(t);
  }, []);

  const pct = Math.round(progress);
  const step = Math.min(LOADING_STEPS.length - 1, Math.floor(progress / 20));
  const active = LOADING_STEPS[step];

  return (
    <section className="mt-10 rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-white px-5 py-10 text-center shadow-sm sm:px-8 dark:border-gray-800 dark:from-blue-950/30 dark:via-gray-900 dark:to-gray-900">
      {/* 히어로 마스코트 */}
      <div className="rise-float mx-auto w-fit">
        <RiseMascot className="h-36 w-36 drop-shadow-md sm:h-40 sm:w-40" />
      </div>

      <h2 className="mt-5 text-xl font-bold leading-snug text-gray-900 sm:text-2xl dark:text-gray-100">
        AI가 우리 회사에 딱 맞는
        <br />
        <span className="text-indigo-600 dark:text-indigo-400">지원사업</span>을
        찾고 있어요…
      </h2>

      {/* 진행바 */}
      <div className="mx-auto mt-5 flex max-w-md items-center gap-3">
        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-blue-100 dark:bg-gray-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-200 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-10 shrink-0 text-right text-sm font-bold text-indigo-600 dark:text-indigo-400">
          {pct}%
        </span>
      </div>
      <p className="mt-2.5 text-xs text-gray-500 dark:text-gray-400">
        잠시만 기다려주세요! 금방 찾을게요 😊
      </p>

      {/* 단계 표시 */}
      <div className="mt-7 flex items-center justify-center gap-1 sm:gap-2">
        {LOADING_STEPS.map((s, i) => (
          <div key={s.title} className="flex items-center gap-1 sm:gap-2">
            <div
              className={`grid h-9 w-9 place-items-center rounded-full text-base transition-all duration-300 sm:h-11 sm:w-11 sm:text-lg ${
                i === step
                  ? "scale-110 bg-indigo-600 shadow-md shadow-indigo-600/30 ring-4 ring-indigo-100 dark:ring-indigo-900/40"
                  : i < step
                    ? "bg-emerald-100 dark:bg-emerald-900/40"
                    : "bg-gray-100 opacity-60 dark:bg-gray-800"
              }`}
            >
              {i < step ? "✓" : s.icon}
            </div>
            {i < LOADING_STEPS.length - 1 && (
              <span
                className={`text-xs ${i < step ? "text-emerald-400" : "text-gray-300 dark:text-gray-700"}`}
              >
                ›
              </span>
            )}
          </div>
        ))}
      </div>

      {/* 현재 단계 설명 (단계가 바뀔 때마다 살짝 등장) */}
      <div key={step} className="rise-pop mt-4">
        <p className="text-sm font-bold text-gray-800 dark:text-gray-100">
          {active.title}
        </p>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {active.sub}
        </p>
      </div>

      {/* TIP */}
      <div className="mx-auto mt-7 flex max-w-lg flex-col items-center gap-2 rounded-xl bg-indigo-50/70 px-4 py-3 text-left sm:flex-row sm:items-start dark:bg-indigo-950/30">
        <span className="shrink-0 text-sm font-bold text-amber-500">💡 TIP</span>
        <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-300">
          입력하신 정보를 기반으로 전국 공공기관의 지원사업을 분석하고 있어요.
          소개·관심분야를 자세히 적을수록 더 정확한 추천을 받을 수 있어요!
        </p>
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

      {/* 탭별 안내: 추천 5선은 개인화, 전체는 조건부합 전부라는 점을 명확히 */}
      <p className="mb-3 rounded-lg bg-blue-50/70 px-3.5 py-2.5 text-xs leading-relaxed text-gray-600 dark:bg-blue-950/30 dark:text-gray-300">
        {tab === "top" ? (
          <>
            <b className="text-blue-700 dark:text-blue-300">추천 5선</b>은 입력하신{" "}
            <b>관심 지원분야·회사 소개</b>를 반영해 적합도가 높은 5건을 골라
            보여줍니다. 관심 분야를 바꾸면 이 5선이 달라져요.
          </>
        ) : (
          <>
            <b className="text-blue-700 dark:text-blue-300">전체</b>는 조건(업종·지역·자격)에
            부합하는 <b>모든 공고</b>입니다 — AI 맞춤 정렬이 아니라서 검색을 바꿔도
            목록이 비슷하게 반복될 수 있어요. 실제 지원 가능 여부는 각 공고의{" "}
            <b>신청 요건을 직접 확인</b>하세요.
          </>
        )}
      </p>

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

// ---------------------------------------------------------------------------
// 소개(랜딩) 페이지 — 로고 클릭 시 표시
// ---------------------------------------------------------------------------

const INTRO_FEATURES = [
  {
    icon: "🎯",
    title: "맞춤 적합도 매칭",
    desc: "업종·지역·업력·관심분야를 반영해 조건에 맞는 지원사업을 골라 적합도 점수로 정렬해드려요.",
  },
  {
    icon: "🔄",
    title: "실시간 공고 수집",
    desc: "기업마당·K-Startup·글로벌aT·판판대로·서울경제진흥원 등 공공 데이터를 자동으로 모아 중복 없이 보여줘요.",
  },
  {
    icon: "📅",
    title: "관심공고 & 마감 캘린더",
    desc: "마음에 드는 공고를 담아두고, 신청 마감일을 월간 캘린더로 한눈에 관리하세요.",
  },
  {
    icon: "📝",
    title: "사업계획서 초안",
    desc: "공고와 회사 정보를 바탕으로 사업계획서 초안을 자동으로 만들어 신청 준비를 도와요.",
  },
  {
    icon: "💳",
    title: "디지털 명함",
    desc: "마이페이지에서 나만의 디지털 명함을 만들어 연락처 저장·공유까지 한 번에.",
  },
  {
    icon: "📰",
    title: "뉴스레터",
    desc: "분야별 주요 공고를 모아 보기 쉽게 정리해드려요.",
  },
] as const;

const INTRO_STEPS = [
  {
    no: "01",
    title: "회사 정보 입력",
    desc: "업종·지역·업력 등 기본 정보와 관심 분야를 입력해요. 예비창업자도 OK.",
  },
  {
    no: "02",
    title: "적합도 추천 받기",
    desc: "조건에 맞는 지원사업을 골라 적합도 점수와 추천 이유까지 보여드려요.",
  },
  {
    no: "03",
    title: "담고 · 관리하고 · 신청",
    desc: "관심공고를 담아 마감 캘린더로 챙기고, 사업계획서 초안으로 신청을 준비하세요.",
  },
] as const;

function IntroView({
  stats,
  onStart,
  onOpenMypage,
  onOpenNewsletter,
}: {
  stats: { total: number; sourceCount: number } | null;
  onStart: () => void;
  onOpenMypage: () => void;
  onOpenNewsletter: () => void;
}) {
  return (
    <div className="space-y-14 pb-10">
      {/* 히어로 */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 px-6 py-14 text-center text-white shadow-xl sm:px-10 sm:py-20">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-violet-300/20 blur-3xl" />

        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Brand Rise 로고"
            className="mx-auto mb-5 h-16 w-16 rounded-2xl object-cover shadow-lg"
          />
          <span className="inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-semibold tracking-wide">
            정부지원사업 매칭 플랫폼
          </span>
          <h1 className="mt-4 text-3xl font-extrabold leading-tight sm:text-5xl">
            흩어진 정부지원사업,
            <br />
            <span className="text-blue-100">내게 맞는 것만 한 곳에서</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-blue-100 sm:text-base">
            수많은 공공기관에 흩어진 지원사업 공고를 실시간으로 모아, 우리 회사
            조건에 맞는 사업만 골라 적합도 순으로 추천해드립니다.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onStart}
              className="rounded-xl bg-white px-6 py-3 text-sm font-bold text-blue-700 shadow-md transition hover:bg-blue-50 sm:text-base"
            >
              🔍 내게 맞는 지원사업 찾기
            </button>
            <button
              type="button"
              onClick={onOpenMypage}
              className="rounded-xl border border-white/40 bg-white/10 px-6 py-3 text-sm font-bold text-white backdrop-blur transition hover:bg-white/20 sm:text-base"
            >
              👤 마이페이지
            </button>
          </div>
          {stats && stats.total > 0 && (
            <p className="mt-6 text-sm text-blue-100">
              📡 지금까지 <b className="text-white">{stats.total.toLocaleString()}개</b>의
              지원사업을 연동했어요
            </p>
          )}
        </div>
      </section>

      {/* 신뢰 지표 */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          {
            big: stats && stats.total > 0 ? `${stats.total.toLocaleString()}건` : "실시간",
            label: "연동된 지원사업",
            sub: "중복 제거 후 최신 유지",
          },
          {
            big: stats && stats.sourceCount > 0 ? `${stats.sourceCount}곳` : "5+",
            label: "공공 데이터 소스",
            sub: "기업마당·K-Startup·보조금24 등",
          },
          { big: "맞춤", label: "조건 기반 적합도 점수", sub: "추천 이유까지 제공" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm dark:border-gray-800 dark:bg-gray-900"
          >
            <div className="text-3xl font-extrabold text-blue-600 dark:text-blue-400">
              {s.big}
            </div>
            <div className="mt-1 text-sm font-bold text-gray-900 dark:text-gray-100">
              {s.label}
            </div>
            <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {s.sub}
            </div>
          </div>
        ))}
      </section>

      {/* 주요 기능 */}
      <section>
        <div className="mb-7 text-center">
          <h2 className="text-2xl font-bold text-gray-900 sm:text-3xl dark:text-gray-100">
            이런 기능이 있어요
          </h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            찾기부터 관리·신청 준비까지, 한 곳에서 끝내세요.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {INTRO_FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
            >
              <div className="text-3xl">{f.icon}</div>
              <h3 className="mt-3 text-base font-bold text-gray-900 dark:text-gray-100">
                {f.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 이용 방법 */}
      <section className="rounded-3xl bg-gray-50 px-6 py-12 dark:bg-gray-800/40 sm:px-10">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900 sm:text-3xl dark:text-gray-100">
            3단계면 충분해요
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {INTRO_STEPS.map((s) => (
            <div key={s.no} className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-lg font-extrabold text-white">
                {s.no}
              </div>
              <h3 className="mt-4 text-base font-bold text-gray-900 dark:text-gray-100">
                {s.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 마무리 CTA */}
      <section className="rounded-3xl bg-gradient-to-br from-blue-600 to-indigo-700 px-6 py-12 text-center text-white shadow-lg sm:px-10">
        <h2 className="text-2xl font-bold sm:text-3xl">
          우리 회사에 맞는 지원사업, 지금 확인하세요
        </h2>
        <p className="mt-2 text-sm text-blue-100">
          회원가입 없이 바로 시작할 수 있어요.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onStart}
            className="rounded-xl bg-white px-6 py-3 text-sm font-bold text-blue-700 shadow-md transition hover:bg-blue-50"
          >
            🔍 지금 추천받기
          </button>
          <button
            type="button"
            onClick={onOpenNewsletter}
            className="rounded-xl border border-white/40 bg-white/10 px-6 py-3 text-sm font-bold text-white backdrop-blur transition hover:bg-white/20"
          >
            📰 뉴스레터 보기
          </button>
        </div>
      </section>

      {/* 푸터 */}
      <footer className="border-t border-gray-200 pt-8 text-center text-xs text-gray-400 dark:border-gray-800">
        <div className="flex items-center justify-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Brand Rise"
            className="h-6 w-6 rounded-md object-cover"
          />
          <span className="font-bold text-gray-600 dark:text-gray-300">
            Brand Rise
          </span>
        </div>
        <p className="mt-2">정부지원사업 추천 플랫폼 · 브랜드라이즈</p>
        <p className="mt-1">
          공공 데이터(기업마당·K-Startup 등)를 활용하며, 실제 신청·자격 요건은 각
          공고 원문을 확인하세요.
        </p>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 마이페이지 (개인 기능 허브: 관심공고·캘린더·사업계획서·디지털 명함·설정)
// ---------------------------------------------------------------------------

function MyPageView({
  myProfile,
  onSaveProfile,
  savedList,
  searchProfile,
  onOpenSaved,
  onGoSearch,
}: {
  myProfile: MyProfile;
  onSaveProfile: (p: MyProfile) => void;
  savedList: Recommendation[];
  searchProfile: CompanyProfile;
  onOpenSaved: (mode: "calendar" | "list") => void;
  onGoSearch: () => void;
}) {
  const [section, setSection] = useState<"home" | "card" | "settings">("home");

  // 곧 마감(오늘~7일 이내) 관심공고 수
  const urgentCount = savedList.filter((r) => {
    const d = r.program.deadlineEnd ? ddayDiff(r.program.deadlineEnd) : null;
    return d !== null && d >= 0 && d <= 7;
  }).length;

  const displayName = myProfile.name || myProfile.company || "회원";
  const profileFilled = !!(myProfile.name || myProfile.company);

  if (section === "settings") {
    return (
      <MyProfileSettings
        myProfile={myProfile}
        searchProfile={searchProfile}
        onSave={(p) => {
          onSaveProfile(p);
          setSection("home");
        }}
        onBack={() => setSection("home")}
      />
    );
  }

  if (section === "card") {
    return (
      <section>
        <BackBar title="💳 나의 디지털 명함" onBack={() => setSection("home")} />
        {profileFilled ? (
          <DigitalCard profile={myProfile} large />
        ) : (
          <SetupHint onSetup={() => setSection("settings")} />
        )}
        <button
          type="button"
          onClick={() => setSection("settings")}
          className="mt-4 w-full rounded-xl border border-gray-300 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-blue-400 dark:border-gray-700 dark:text-gray-200"
        >
          ✏️ 명함 정보 편집
        </button>
      </section>
    );
  }

  // ── 홈(대시보드) ──
  return (
    <section className="space-y-6">
      {/* 인사 히어로 */}
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 p-6 text-white shadow-lg sm:p-7">
        <p className="text-sm text-blue-100">마이페이지</p>
        <h2 className="mt-1 text-2xl font-bold">
          안녕하세요, {displayName}님 👋
        </h2>
        <p className="mt-1 text-sm text-blue-100">
          관심공고와 마감일정을 한곳에서 관리하세요.
        </p>
      </div>

      {/* 디지털 명함 미리보기 / 설정 유도 */}
      {profileFilled ? (
        <DigitalCard profile={myProfile} onEdit={() => setSection("settings")} />
      ) : (
        <SetupHint onSetup={() => setSection("settings")} />
      )}

      {/* 요약 통계 */}
      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label="관심 공고"
          value={`${savedList.length}건`}
          tone="blue"
          onClick={() => onOpenSaved("list")}
        />
        <StatTile
          label="곧 마감 (7일 이내)"
          value={`${urgentCount}건`}
          tone="red"
          onClick={() => onOpenSaved("calendar")}
        />
      </div>

      {/* 기능 타일 */}
      <div>
        <h3 className="mb-3 text-sm font-bold text-gray-500 dark:text-gray-400">
          기능 바로가기
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <FeatureTile
            icon="🔖"
            title="내 관심 공고"
            desc="담아둔 지원사업"
            onClick={() => onOpenSaved("list")}
          />
          <FeatureTile
            icon="📅"
            title="마감 캘린더"
            desc="달력으로 한눈에"
            onClick={() => onOpenSaved("calendar")}
          />
          <FeatureTile
            icon="📝"
            title="사업계획서 작성"
            desc="관심공고로 초안"
            onClick={() => onOpenSaved("list")}
          />
          <FeatureTile
            icon="💳"
            title="디지털 명함"
            desc="공유·연락처 저장"
            onClick={() => setSection("card")}
          />
          <FeatureTile
            icon="⚙️"
            title="프로필 설정"
            desc="명함·인사말 정보"
            onClick={() => setSection("settings")}
          />
          <FeatureTile
            icon="🔍"
            title="지원사업 검색"
            desc="맞춤 추천 받기"
            onClick={onGoSearch}
          />
        </div>
      </div>
    </section>
  );
}

/** 마이페이지 내부 화면 상단의 뒤로가기 바 */
function BackBar({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
        aria-label="마이페이지로"
      >
        ‹ 뒤로
      </button>
      <h2 className="text-lg font-bold">{title}</h2>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  tone: "blue" | "red";
  onClick: () => void;
}) {
  const toneCls =
    tone === "red"
      ? "text-red-600 dark:text-red-400"
      : "text-blue-600 dark:text-blue-400";
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-400 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className={`text-2xl font-extrabold ${toneCls}`}>{value}</div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{label}</div>
    </button>
  );
}

function FeatureTile({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: string;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-1 rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
    >
      <span className="text-2xl">{icon}</span>
      <span className="mt-1 text-sm font-bold text-gray-900 dark:text-gray-100">
        {title}
      </span>
      <span className="text-xs text-gray-500 dark:text-gray-400">{desc}</span>
    </button>
  );
}

/** 프로필 미설정 시 명함 자리에 띄우는 설정 유도 카드 */
function SetupHint({ onSetup }: { onSetup: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center dark:border-gray-700 dark:bg-gray-800/50">
      <div className="text-3xl">💳</div>
      <p className="mt-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
        나만의 디지털 명함을 만들어보세요
      </p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        이름·연락처를 입력하면 공유·연락처 저장이 가능한 명함이 만들어져요.
      </p>
      <button
        type="button"
        onClick={onSetup}
        className="mt-3 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
      >
        프로필 설정하기
      </button>
    </div>
  );
}

/** vCard(.vcf) 텍스트 생성 — 휴대폰 연락처에 바로 저장 가능한 표준 포맷 */
function buildVCard(p: MyProfile): string {
  const esc = (s: string) =>
    s.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${esc(p.name || p.company || "명함")}`,
    p.name && `N:${esc(p.name)};;;;`,
    p.company && `ORG:${esc(p.company)}`,
    p.title && `TITLE:${esc(p.title)}`,
    p.phone && `TEL;TYPE=CELL:${esc(p.phone)}`,
    p.email && `EMAIL;TYPE=INTERNET:${esc(p.email)}`,
    p.website && `URL:${esc(p.website)}`,
    p.tagline && `NOTE:${esc(p.tagline)}`,
    "END:VCARD",
  ].filter(Boolean) as string[];
  return lines.join("\r\n");
}

/** 디지털 명함 카드 + 동작(연락처 저장·복사·공유) */
function DigitalCard({
  profile,
  large,
  onEdit,
}: {
  profile: MyProfile;
  large?: boolean;
  onEdit?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function plainText(): string {
    return [
      profile.name && profile.title
        ? `${profile.name} (${profile.title})`
        : profile.name,
      profile.company,
      profile.tagline,
      profile.phone && `📞 ${profile.phone}`,
      profile.email && `✉️ ${profile.email}`,
      profile.website && `🌐 ${profile.website}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(plainText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 클립보드 권한 없으면 무시 */
    }
  }

  function downloadVCard() {
    const blob = new Blob([buildVCard(profile)], {
      type: "text/vcard;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${profile.name || profile.company || "명함"}.vcf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function share() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: profile.name || profile.company || "명함",
          text: plainText(),
        });
      } catch {
        /* 사용자가 공유 취소 */
      }
    } else {
      copy();
    }
  }

  const initials = (profile.name || profile.company || "?").slice(0, 2);

  return (
    <div>
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 via-slate-900 to-black p-6 text-white shadow-lg">
        {/* 장식용 광원 */}
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-blue-500/20 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-12 -left-8 h-40 w-40 rounded-full bg-violet-500/20 blur-2xl" />

        <div className="relative flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-violet-500 text-lg font-bold">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className={`font-bold ${large ? "text-2xl" : "text-xl"}`}>
              {profile.name || "이름 미설정"}
            </h3>
            <p className="text-sm text-blue-200">
              {[profile.title, profile.company].filter(Boolean).join(" · ") ||
                "직책·회사 미설정"}
            </p>
          </div>
        </div>

        {profile.tagline && (
          <p className="relative mt-4 text-sm leading-relaxed text-gray-300">
            “{profile.tagline}”
          </p>
        )}

        <dl className="relative mt-4 space-y-1.5 text-sm">
          {profile.phone && (
            <div className="flex items-center gap-2 text-gray-200">
              <span>📞</span>
              <a href={`tel:${profile.phone}`} className="hover:underline">
                {profile.phone}
              </a>
            </div>
          )}
          {profile.email && (
            <div className="flex items-center gap-2 text-gray-200">
              <span>✉️</span>
              <a href={`mailto:${profile.email}`} className="break-all hover:underline">
                {profile.email}
              </a>
            </div>
          )}
          {profile.website && (
            <div className="flex items-center gap-2 text-gray-200">
              <span>🌐</span>
              <span className="break-all">{profile.website}</span>
            </div>
          )}
          {(profile.industry || profile.region) && (
            <div className="flex items-center gap-2 text-gray-400">
              <span>🏷</span>
              <span>
                {[profile.industry, profile.region].filter(Boolean).join(" · ")}
              </span>
            </div>
          )}
        </dl>
      </div>

      {/* 동작 버튼 */}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={downloadVCard}
          className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          📇 연락처 저장
        </button>
        <button
          type="button"
          onClick={copy}
          className="rounded-xl border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 transition hover:border-blue-400 dark:border-gray-700 dark:text-gray-200"
        >
          {copied ? "복사됨!" : "📋 정보 복사"}
        </button>
        <button
          type="button"
          onClick={share}
          className="rounded-xl border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 transition hover:border-blue-400 dark:border-gray-700 dark:text-gray-200"
        >
          🔗 공유
        </button>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="ml-auto rounded-xl px-3 py-2 text-sm font-semibold text-gray-500 transition hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            ✏️ 편집
          </button>
        )}
      </div>
    </div>
  );
}

/** 마이페이지 프로필 설정 폼 */
function MyProfileSettings({
  myProfile,
  searchProfile,
  onSave,
  onBack,
}: {
  myProfile: MyProfile;
  searchProfile: CompanyProfile;
  onSave: (p: MyProfile) => void;
  onBack: () => void;
}) {
  const [form, setForm] = useState<MyProfile>(myProfile);
  function set<K extends keyof MyProfile>(k: K, v: MyProfile[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const canImport = !!(
    searchProfile.name ||
    searchProfile.industry ||
    searchProfile.region ||
    searchProfile.description
  );

  function importFromSearch() {
    setForm((f) => ({
      ...f,
      company: f.company || searchProfile.name,
      industry: f.industry || searchProfile.industry,
      region: f.region || searchProfile.region,
      tagline: f.tagline || searchProfile.description.slice(0, 60),
    }));
  }

  return (
    <section>
      <BackBar title="⚙️ 프로필 설정" onBack={onBack} />
      <p className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-xs leading-relaxed text-gray-600 dark:bg-blue-950/30 dark:text-gray-400">
        💡 입력한 정보는 디지털 명함과 마이페이지 인사말에 사용돼요. 이 브라우저에만
        저장되며 서버로 전송되지 않습니다.
      </p>

      {canImport && (
        <button
          type="button"
          onClick={importFromSearch}
          className="mb-4 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:border-blue-400 dark:border-gray-700 dark:text-gray-300"
        >
          ↪ 최근 검색 정보 가져오기
        </button>
      )}

      <div className="space-y-4">
        <Field label="이름">
          <input
            className={inputCls}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="홍길동"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="회사명 / 상호">
            <input
              className={inputCls}
              value={form.company}
              onChange={(e) => set("company", e.target.value)}
              placeholder="브랜드라이즈"
            />
          </Field>
          <Field label="직책">
            <input
              className={inputCls}
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="대표"
            />
          </Field>
        </div>
        <Field label="휴대폰">
          <input
            className={inputCls}
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="010-1234-5678"
            inputMode="tel"
          />
        </Field>
        <Field label="이메일">
          <input
            className={inputCls}
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="me@example.com"
            inputMode="email"
          />
        </Field>
        <Field label="웹사이트 / SNS">
          <input
            className={inputCls}
            value={form.website}
            onChange={(e) => set("website", e.target.value)}
            placeholder="https://..."
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="업종">
            <input
              className={inputCls}
              value={form.industry}
              onChange={(e) => set("industry", e.target.value)}
              placeholder="IT/소프트웨어"
            />
          </Field>
          <Field label="지역">
            <input
              className={inputCls}
              value={form.region}
              onChange={(e) => set("region", e.target.value)}
              placeholder="서울"
            />
          </Field>
        </div>
        <Field label="한 줄 소개">
          <input
            className={inputCls}
            value={form.tagline}
            onChange={(e) => set("tagline", e.target.value)}
            placeholder="고객의 브랜드 성장을 돕습니다"
            maxLength={60}
          />
        </Field>
      </div>

      <div className="mt-6 flex gap-2">
        <button
          type="button"
          onClick={() => onSave(form)}
          className="flex-1 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white transition hover:bg-blue-700"
        >
          저장
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl border border-gray-300 px-5 py-3 text-sm font-semibold text-gray-600 transition hover:border-gray-400 dark:border-gray-700 dark:text-gray-300"
        >
          취소
        </button>
      </div>
    </section>
  );
}

function SavedView({
  savedList,
  profile,
  isSaved,
  onToggleSave,
  initialMode = "calendar",
}: {
  savedList: Recommendation[];
  profile: CompanyProfile;
  isSaved: (id: string) => boolean;
  onToggleSave: (rec: Recommendation) => void;
  initialMode?: "calendar" | "list";
}) {
  // 목록 / 캘린더 보기 전환. 마감일을 한눈에 보려는 게 주 목적이라 캘린더를 기본으로.
  const [mode, setMode] = useState<"calendar" | "list">(initialMode);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">
          🔖 관심공고{" "}
          <span className="text-gray-400">({savedList.length}건)</span>
        </h2>
        {savedList.length > 0 && (
          <div className="flex shrink-0 rounded-lg border border-gray-300 p-0.5 text-xs font-semibold dark:border-gray-700">
            {(["calendar", "list"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-md px-3 py-1.5 transition ${
                  mode === m
                    ? "bg-blue-600 text-white"
                    : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                {m === "calendar" ? "📅 캘린더" : "📋 목록"}
              </button>
            ))}
          </div>
        )}
      </div>

      {savedList.length === 0 ? (
        <p className="rounded-xl bg-gray-50 px-4 py-10 text-center text-sm text-gray-500 dark:bg-gray-800/60">
          아직 담은 관심공고가 없어요.
          <br />
          추천 결과에서 <b>관심공고 담기</b>를 눌러 모아보세요.
        </p>
      ) : mode === "calendar" ? (
        <SavedCalendar
          savedList={savedList}
          profile={profile}
          isSaved={isSaved}
          onToggleSave={onToggleSave}
        />
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

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** "YYYY-MM-DD" → {y,m,d} (로컬 타임존 파싱 이슈 없이 문자열로 분해) */
function parseYmd(s?: string): { y: number; m: number; d: number } | null {
  const m = (s ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function ymdKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * 찜한 공고를 월간 캘린더에 마감일(deadlineEnd) 기준으로 배치한다.
 * - 날짜 칸은 그날 마감인 공고 수를 가장 임박한 색으로 표시
 * - 날짜를 누르면 그날 마감 공고를 기존 RecCard로 펼쳐 보여줌
 * - 마감일이 없는(상시/미정) 공고는 캘린더 아래 별도 목록으로
 */
function SavedCalendar({
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
  // 마감일별 그룹 + 마감일 미정 분리
  const { byDate, noDeadline } = useMemo(() => {
    const byDate = new Map<string, Recommendation[]>();
    const noDeadline: Recommendation[] = [];
    for (const rec of savedList) {
      const p = parseYmd(rec.program.deadlineEnd);
      if (!p) {
        noDeadline.push(rec);
        continue;
      }
      const key = ymdKey(p.y, p.m, p.d);
      const arr = byDate.get(key) ?? [];
      arr.push(rec);
      byDate.set(key, arr);
    }
    return { byDate, noDeadline };
  }, [savedList]);

  // 초기 표시 월: 마감일이 가장 가까운(또는 가장 이른) 찜 공고가 있는 달.
  // 없으면 오늘 달. (마운트 시 한 번만 계산)
  const [cursor, setCursor] = useState(() => {
    const keys = Array.from(byDate.keys()).sort();
    const now = new Date();
    const todayKey = ymdKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
    const upcoming = keys.find((k) => k >= todayKey) ?? keys[0];
    const base = parseYmd(upcoming);
    return base
      ? { y: base.y, m: base.m }
      : { y: now.getFullYear(), m: now.getMonth() + 1 };
  });

  const [selected, setSelected] = useState<string | null>(null);

  // 달력 그리드: 1일의 요일만큼 앞을 비우고, 그 달 일수만큼 채운다.
  const cells = useMemo(() => {
    const firstWeekday = new Date(cursor.y, cursor.m - 1, 1).getDay();
    const daysInMonth = new Date(cursor.y, cursor.m, 0).getDate();
    const out: (number | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(d);
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [cursor]);

  const now = new Date();
  const todayKey = ymdKey(now.getFullYear(), now.getMonth() + 1, now.getDate());

  function shiftMonth(delta: number) {
    setSelected(null);
    setCursor((c) => {
      const m0 = c.m - 1 + delta; // 0-indexed 월로 계산
      const y = c.y + Math.floor(m0 / 12);
      const m = ((m0 % 12) + 12) % 12;
      return { y, m: m + 1 };
    });
  }

  const selectedRecs = selected ? (byDate.get(selected) ?? []) : [];

  // 이번 달 마감 공고 수 (안내용)
  const monthPrefix = `${cursor.y}-${String(cursor.m).padStart(2, "0")}`;
  const monthCount = Array.from(byDate.entries())
    .filter(([k]) => k.startsWith(monthPrefix))
    .reduce((n, [, recs]) => n + recs.length, 0);

  return (
    <div>
      {/* 월 네비게이션 */}
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="rounded-lg px-3 py-1.5 text-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          aria-label="이전 달"
        >
          ‹
        </button>
        <div className="text-center">
          <div className="text-lg font-bold">
            {cursor.y}년 {cursor.m}월
          </div>
          <div className="text-xs text-gray-400">이 달 마감 {monthCount}건</div>
        </div>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="rounded-lg px-3 py-1.5 text-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          aria-label="다음 달"
        >
          ›
        </button>
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 text-center text-xs font-semibold text-gray-400">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={`py-1 ${i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : ""}`}
          >
            {w}
          </div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d === null) return <div key={`e${i}`} />;
          const key = ymdKey(cursor.y, cursor.m, d);
          const recs = byDate.get(key);
          const count = recs?.length ?? 0;
          // 칸 색조: 그날 공고 중 가장 임박한 것 기준
          const diffs = (recs ?? [])
            .map((r) => ddayDiff(r.program.deadlineEnd!))
            .filter((n): n is number => n !== null);
          const minDiff = diffs.length ? Math.min(...diffs) : null;
          const tone =
            minDiff === null
              ? ""
              : minDiff < 0
                ? "bg-gray-100 text-gray-400 dark:bg-gray-800"
                : minDiff <= 7
                  ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                  : minDiff <= 14
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                    : "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300";
          const isToday = key === todayKey;
          const isSelected = key === selected;
          return (
            <button
              key={key}
              type="button"
              disabled={count === 0}
              onClick={() => setSelected(isSelected ? null : key)}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-lg text-sm transition ${
                isSelected
                  ? "ring-2 ring-blue-500"
                  : count > 0
                    ? "hover:ring-2 hover:ring-blue-300"
                    : "cursor-default"
              } ${count > 0 ? tone : "text-gray-500 dark:text-gray-400"} ${
                isToday ? "font-extrabold underline decoration-2 underline-offset-2" : ""
              }`}
            >
              <span>{d}</span>
              {count > 0 && (
                <span className="mt-0.5 text-[10px] font-bold leading-none">
                  {count}건
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-center text-xs text-gray-400">
        날짜를 누르면 그날 마감인 관심공고를 볼 수 있어요.
      </p>

      {/* 선택한 날짜의 마감 공고 */}
      {selected && selectedRecs.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-3 text-sm font-bold text-gray-700 dark:text-gray-200">
            🗓 {Number(selected.slice(5, 7))}월 {Number(selected.slice(8, 10))}일 마감{" "}
            <span className="text-gray-400">({selectedRecs.length}건)</span>
          </h3>
          <ul className="space-y-4">
            {selectedRecs.map((rec, i) => (
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
        </div>
      )}

      {/* 마감일 미정/상시 공고 */}
      {noDeadline.length > 0 && (
        <div className="mt-6 border-t border-gray-200 pt-5 dark:border-gray-800">
          <h3 className="mb-3 text-sm font-bold text-gray-700 dark:text-gray-200">
            📌 마감일 미정 · 상시{" "}
            <span className="text-gray-400">({noDeadline.length}건)</span>
          </h3>
          <ul className="space-y-4">
            {noDeadline.map((rec, i) => (
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
        </div>
      )}
    </div>
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
            onClick={() =>
              track("program_click", {
                programId: program.id,
                programTitle: program.title,
              })
            }
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
