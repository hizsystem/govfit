"use client";

import { useEffect, useMemo, useState } from "react";
import type { Category, DataSource, SupportProgram } from "@/lib/types";
import { CATEGORIES, REGIONS } from "@/lib/constants";
import { ddayDiff } from "@/lib/dday";
import { ProgramCard } from "@/components/ProgramCard";

interface ProgramsData {
  programs: SupportProgram[];
  total: number;
  bySource: Record<string, number>;
  dataSource: DataSource;
}

type SortKey = "deadlineAsc" | "deadlineDesc";

const PER_PAGE = 15;

/**
 * 전체 공고 둘러보기 화면.
 *
 * /api/programs(지금 신청 가능한 공고 전체, 1시간 캐시)를 한 번 받아와
 * 키워드 검색·분야·지역·소스 필터·마감 정렬을 모두 클라이언트에서 처리한다.
 * (공고가 수백 건 규모라 클라이언트 필터가 빠르고 서버 부담이 없다.)
 * 찜하기는 추천 화면과 같은 저장소를 쓰도록 부모가 내려준 핸들러로 위임한다.
 */
export function BrowseView({
  isSaved,
  onToggleSave,
}: {
  isSaved: (id: string) => boolean;
  onToggleSave: (program: SupportProgram) => void;
}) {
  const [data, setData] = useState<ProgramsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // 필터 상태
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState<Category | "all">("all");
  const [region, setRegion] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("deadlineAsc");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let alive = true;
    fetch("/api/programs")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((d: ProgramsData) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 소스 셀렉트 선택지 (건수 많은 순)
  const sources = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.bySource).sort((a, b) => b[1] - a[1]);
  }, [data]);

  // 필터 + 정렬 결과
  const filtered = useMemo(() => {
    if (!data) return [];
    const kw = keyword.trim().toLowerCase();
    const matched = data.programs.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (source !== "all" && (p.source ?? "기타") !== source) return false;
      // 지역: 지정 지역에 포함되거나, 지역 제한이 없는(전국) 공고는 항상 노출
      if (region !== "all" && p.regions.length > 0 && !p.regions.includes(region))
        return false;
      if (kw) {
        const hay = [
          p.title,
          p.agency,
          p.summary,
          p.target ?? "",
          p.subCategory ?? "",
          p.supportSummary ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
    return sortByDeadline(matched, sort);
  }, [data, keyword, category, region, source, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageList = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  // 필터가 바뀌면 첫 페이지로
  function resetPage<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  if (loading) {
    return (
      <Wrap>
        <p className="rounded-xl bg-gray-50 px-4 py-10 text-center text-sm text-gray-500 dark:bg-gray-800/60">
          연동 중인 전체 공고를 불러오는 중…
        </p>
      </Wrap>
    );
  }
  if (error || !data) {
    return (
      <Wrap>
        <p className="rounded-xl bg-red-50 px-4 py-6 text-center text-sm text-red-600 dark:bg-red-950/40">
          공고를 불러오지 못했어요. 잠시 후 다시 시도해주세요.
        </p>
      </Wrap>
    );
  }

  return (
    <Wrap>
      {/* 소스별 건수 배지 */}
      <div className="mb-4 flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-600/10 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-400/10 dark:text-blue-300">
          📡 지금 신청 가능 <b>{data.total.toLocaleString()}건</b>
        </span>
        {sources.map(([name, count]) => (
          <span
            key={name}
            className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300"
          >
            {name} <b>{count}</b>
          </span>
        ))}
      </div>

      {/* 검색창 */}
      <div className="relative mb-3">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
          🔍
        </span>
        <input
          type="search"
          value={keyword}
          onChange={(e) => resetPage(setKeyword)(e.target.value)}
          placeholder="공고명·기관·키워드로 검색 (예: 창업, 수출, R&D)"
          className="w-full rounded-xl border border-gray-300 bg-white py-3 pl-10 pr-4 text-sm outline-none transition hover:border-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-950 dark:focus:ring-blue-900/40"
        />
      </div>

      {/* 분야 칩 */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        <FilterChip active={category === "all"} onClick={() => resetPage(setCategory)("all")}>
          전체 분야
        </FilterChip>
        {CATEGORIES.map((c) => (
          <FilterChip
            key={c}
            active={category === c}
            onClick={() => resetPage(setCategory)(c)}
          >
            {c}
          </FilterChip>
        ))}
      </div>

      {/* 지역 · 소스 · 정렬 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={region}
          onChange={(e) => resetPage(setRegion)(e.target.value)}
          className={selectCls}
          aria-label="지역 필터"
        >
          <option value="all">전체 지역</option>
          {REGIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select
          value={source}
          onChange={(e) => resetPage(setSource)(e.target.value)}
          className={selectCls}
          aria-label="출처 필터"
        >
          <option value="all">전체 출처</option>
          {sources.map(([name]) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => resetPage(setSort)(e.target.value as SortKey)}
          className={selectCls}
          aria-label="정렬"
        >
          <option value="deadlineAsc">마감 임박순</option>
          <option value="deadlineDesc">마감 여유순</option>
        </select>
        <span className="ml-auto text-xs text-gray-400">
          {filtered.length.toLocaleString()}건
          {totalPages > 1 && ` · ${safePage}/${totalPages} 페이지`}
        </span>
      </div>

      {pageList.length === 0 ? (
        <p className="rounded-xl bg-gray-50 px-4 py-10 text-center text-sm text-gray-500 dark:bg-gray-800/60">
          조건에 맞는 공고가 없어요. 검색어나 필터를 바꿔보세요.
        </p>
      ) : (
        <ul className="space-y-4">
          {pageList.map((p) => (
            <ProgramCard
              key={p.id}
              program={p}
              saved={isSaved(p.id)}
              onToggleSave={() => onToggleSave(p)}
            />
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <Pager page={safePage} totalPages={totalPages} onChange={setPage} />
      )}

      <p className="mt-8 text-center text-xs text-gray-400">
        ※ 지금 신청 가능한(모집중) 공고만 모았어요. 마감·자격 등 정확한 내용은 각
        공고 상세에서 확인하세요.
      </p>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1 text-xl font-bold">📋 전체 공고 둘러보기</h2>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        우리가 모은 지원사업 공고를 추천 없이 직접 보고 검색할 수 있어요.
      </p>
      {children}
    </section>
  );
}

const selectCls =
  "rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm outline-none transition hover:border-gray-400 focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950";

function FilterChip({
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
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? "bg-blue-600 text-white"
          : "border border-gray-300 bg-white text-gray-600 hover:border-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
      }`}
    >
      {children}
    </button>
  );
}

/** 마감 정렬: 진행중(마감 전) 먼저, 상시/열린마감 다음, 마감 지난 건 맨 뒤. */
function sortByDeadline(
  programs: SupportProgram[],
  sort: SortKey,
): SupportProgram[] {
  const bucketed = programs.map((p) => {
    const diff = p.deadlineEnd ? ddayDiff(p.deadlineEnd) : null;
    // 0=진행중, 1=상시/열린마감, 2=마감 지남
    const bucket = diff === null ? 1 : diff < 0 ? 2 : 0;
    return { p, diff, bucket };
  });
  bucketed.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket - b.bucket;
    if (a.bucket !== 0) return 0;
    const da = a.diff as number;
    const db = b.diff as number;
    return sort === "deadlineAsc" ? da - db : db - da;
  });
  return bucketed.map((x) => x.p);
}

function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
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
