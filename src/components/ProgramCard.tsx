"use client";

import type { SupportProgram } from "@/lib/types";
import { computeDday, type Dday } from "@/lib/dday";
import { track } from "@/lib/track";

/**
 * 전체 공고 둘러보기 목록용 경량 카드.
 *
 * 추천 화면의 RecCard와 달리 적합도 점수·추천 이유·사업계획서 초안이 없다
 * (개인화가 아니라 단순 열람·검색이므로). 제목·분야·소스·마감·핵심 정보와
 * 찜하기·상세보기만 담는다.
 */
export function ProgramCard({
  program,
  saved,
  onToggleSave,
}: {
  program: SupportProgram;
  saved: boolean;
  onToggleSave: () => void;
}) {
  const dday = program.deadlineEnd ? computeDday(program.deadlineEnd) : null;
  const fieldLabel = program.subCategory
    ? `${program.category} › ${program.subCategory}`
    : program.category;
  const period = formatPeriod(program);

  return (
    <li className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-blue-200 hover:shadow-md dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
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
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-gray-50 px-3.5 py-3 dark:bg-gray-800/50">
        <dl className="space-y-1.5">
          <KV icon="📍" label="지역" value={regionLabel(program.regions)} />
          <KV icon="🏛" label="수행기관" value={program.agency} />
          <KV icon="🗓" label="신청기간" value={period} />
          <KV
            icon="🎯"
            label="사업목적"
            value={program.purpose || program.summary}
            clamp
          />
          {program.supportSummary && (
            <KV icon="🎁" label="지원내용" value={program.supportSummary} clamp />
          )}
        </dl>
      </div>

      <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
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
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
        >
          📄 공고 상세 보기 <span aria-hidden>↗</span>
        </a>
        <p className="mt-2 text-center text-xs text-gray-400">
          자격·평가기준 등 상세는 공고에서 확인하세요
        </p>
      </div>
    </li>
  );
}

/** 지역 표시: 지정 지역이 없으면(전국 대상) "전국" */
function regionLabel(regions: string[]): string {
  return regions.length > 0 ? regions.join(" · ") : "전국";
}

/** 신청기간 표시 문자열: 종료일이 열려있으면(모집 완료시) 그렇게 표기 */
function formatPeriod(program: SupportProgram): string {
  if (program.deadlineStart && !program.deadlineEnd) {
    return `${program.deadlineStart} ~ 모집 완료 시까지`;
  }
  return program.deadline;
}

/** 아이콘 + 라벨 + 값 한 줄 */
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
      <dt className="w-20 shrink-0 whitespace-nowrap font-medium text-gray-400">
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
