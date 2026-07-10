"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Bar,
  Cell,
  ComposedChart,
  CartesianGrid,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  buildMonthlySummaries,
  getMonthAnalysis,
  getTopStockItems,
  getTopUsedItems,
} from "@/lib/analytics";
import { exportItemsToWorkbook, parseConsumableExcel } from "@/lib/excel";
import {
  departmentLabel,
  formatNumber,
  formatPercent,
  formatWon,
} from "@/lib/format";
import {
  saveAuditLog,
  saveIssues,
  saveItems,
  saveUploadResult,
  saveUploads,
  loadAllData,
} from "@/lib/repository";
import type {
  AuditLog,
  ConsumableItem,
  Department,
  MonthlySummary,
  Role,
  UploadRecord,
  ValidationIssue,
} from "@/lib/types";
import { recalculateItem, validateItems } from "@/lib/validation";

type EditableField = keyof Pick<
  ConsumableItem,
  | "itemName"
  | "specification"
  | "unit"
  | "location"
  | "prevQty"
  | "inQty"
  | "currentQty"
  | "unitPrice"
  | "note"
>;

type ReportView = "all" | Department;
type Screen = "report" | "login" | "manage";

type AmountRow = {
  label: string;
  prevAmount: number;
  inAmount: number;
  usedAmount: number;
  currentAmount: number;
  note?: string;
  total?: boolean;
};

type ComparisonRow = {
  label: string;
  previousUsed: number;
  currentUsed: number;
  diff: number;
  rate: number | null;
  total?: boolean;
};

const currentYear = new Date().getFullYear();
const TEAM_NAME = "가치실천팀";
const CHART_COLORS = {
  total: "#0B2D4D",
  cleaning: "#4EA5A3",
  food: "#C7A452",
  trend: "#2F80ED",
};

const DONUT_COLORS = [
  "#2563EB",
  "#4EA5A3",
  "#F59E0B",
  "#8B5CF6",
  "#64748B",
  "#0B2D4D",
  "#14B8A6",
  "#F97316",
  "#7C3AED",
  "#475569",
];

const reportViewOptions: {
  value: ReportView;
  label: string;
  description: string;
}[] = [
  { value: "all", label: "종합 정보", description: "미화와 푸드 합산" },
  {
    value: "cleaning",
    label: "미화·의약품만 보기",
    description: "미화·의약품 현황",
  },
  { value: "food", label: "푸드만 보기", description: "푸드 현황" },
];

function canManage(role: Role, department: Department) {
  if (role === "admin") return true;
  if (department === "cleaning") return role === "cleaning_manager";
  return role === "food_manager";
}

function reportViewLabel(view: ReportView) {
  if (view === "all") return "종합 정보";
  return departmentLabel(view);
}

function sumAmounts(items: ConsumableItem[]) {
  return items.reduce(
    (acc, item) => ({
      prevAmount: acc.prevAmount + item.prevAmount,
      inAmount: acc.inAmount + item.inAmount,
      usedAmount: acc.usedAmount + item.usedAmount,
      currentAmount: acc.currentAmount + item.currentAmount,
    }),
    { prevAmount: 0, inAmount: 0, usedAmount: 0, currentAmount: 0 },
  );
}

function buildAmountRows(
  items: ConsumableItem[],
  view: ReportView,
): AmountRow[] {
  const cleaning = sumAmounts(
    items.filter((item) => item.department === "cleaning"),
  );
  const food = sumAmounts(items.filter((item) => item.department === "food"));
  const total = sumAmounts(items);

  if (view === "cleaning") return [{ label: "미화/의약품", ...cleaning }];
  if (view === "food") return [{ label: "푸드", ...food }];
  return [
    { label: "미화/의약품", ...cleaning },
    { label: "푸드", ...food },
    { label: "합계", ...total, total: true },
  ];
}

function findPreviousSummary(
  summaries: MonthlySummary[],
  year: number,
  month: number,
) {
  const currentIndex = summaries.findIndex(
    (summary) => summary.year === year && summary.month === month,
  );
  return currentIndex > 0 ? summaries[currentIndex - 1] : undefined;
}

function valueForView(summary: MonthlySummary | undefined, view: ReportView) {
  if (!summary) return 0;
  if (view === "cleaning") return summary.cleaningUsed;
  if (view === "food") return summary.foodUsed;
  return summary.totalUsed;
}

function buildComparisonRows(
  current: MonthlySummary | undefined,
  previous: MonthlySummary | undefined,
  view: ReportView,
): ComparisonRow[] {
  const makeRow = (
    label: string,
    currentUsed: number,
    previousUsed: number,
    total = false,
  ): ComparisonRow => {
    const diff = currentUsed - previousUsed;
    const rate = previousUsed === 0 ? null : (diff / previousUsed) * 100;
    return { label, previousUsed, currentUsed, diff, rate, total };
  };

  if (view === "all") {
    return [
      makeRow(
        "미화/의약품",
        current?.cleaningUsed ?? 0,
        previous?.cleaningUsed ?? 0,
      ),
      makeRow("푸드", current?.foodUsed ?? 0, previous?.foodUsed ?? 0),
      makeRow("합계", current?.totalUsed ?? 0, previous?.totalUsed ?? 0, true),
    ];
  }

  return [
    makeRow(
      departmentLabel(view),
      valueForView(current, view),
      valueForView(previous, view),
      true,
    ),
  ];
}

function Sidebar({
  screen,
  adminUnlocked,
  onOpenReport,
  onOpenAdmin,
}: {
  screen: Screen;
  adminUnlocked: boolean;
  onOpenReport: () => void;
  onOpenAdmin: () => void;
}) {
  return (
    <aside className="sidebar no-print">
      <div className="brand-lockup brand-logo-only">
        <img
          src="/pulmuone-academy-ci-white.png"
          alt="풀무원아카데미"
          className="brand-ci"
        />
      </div>
      <nav className="sidebar-nav" aria-label="주요 메뉴">
        <button
          type="button"
          className={screen === "report" ? "active" : undefined}
          onClick={onOpenReport}
        >
          소모품 운영현황
        </button>
        <button
          type="button"
          className={screen !== "report" ? "active" : undefined}
          onClick={onOpenAdmin}
        >
          관리자 접속
        </button>
      </nav>
      <div className="sidebar-note">
        <b>데이터 기준 안내</b>
        <p>
          본 대시보드는 업로드된 엑셀 데이터를 기준으로 집계되며, 실시간 연동은
          아닙니다.
        </p>
      </div>
      <div className="sidebar-user">
        <span>{adminUnlocked ? "관리자 인증 완료" : "운영현황"}</span>
      </div>
    </aside>
  );
}


function AppHeader({
  screen,
  adminUnlocked,
  onOpenReport,
  onOpenAdmin,
}: {
  screen: Screen;
  adminUnlocked: boolean;
  onOpenReport: () => void;
  onOpenAdmin: () => void;
}) {
  return (
    <header className="app-header no-print">
      <div className="app-header-inner">
        <button type="button" className="header-brand" onClick={onOpenReport}>
          <img
            src="/pulmuone-academy-ci-white.png"
            alt="풀무원아카데미"
            className="header-ci"
          />
        </button>
        <nav className="header-nav" aria-label="주요 메뉴">
          <button
            type="button"
            className={screen === "report" ? "active" : undefined}
            onClick={onOpenReport}
          >
            소모품 운영현황
          </button>
          <button
            type="button"
            className={screen !== "report" ? "active" : undefined}
            onClick={onOpenAdmin}
          >
            {adminUnlocked ? "데이터 관리" : "관리자 접속"}
          </button>
        </nav>
      </div>
    </header>
  );
}

function KpiCard({
  title,
  value,
  sub,
  icon = "◦",
}: {
  title: string;
  value: string;
  sub?: string;
  icon?: string;
}) {
  return (
    <div className="kpi-card">
      <div className="kpi-icon" aria-hidden="true">
        {icon}
      </div>
      <div>
        <div className="kpi-title">{title}</div>
        <div className="kpi-value">{value}</div>
        {sub && <div className="kpi-sub">{sub}</div>}
      </div>
    </div>
  );
}

function splitAmountSub(
  label: string,
  cleaningAmount: number,
  foodAmount: number,
  view: ReportView,
) {
  if (view !== "all") return `${reportViewLabel(view)} 기준`;
  return `미화/의약품 ${formatWon(cleaningAmount)} · 푸드 ${formatWon(foodAmount)}`;
}

function DepartmentBadge({ department }: { department: Department }) {
  return (
    <span className={`dept-badge ${department}`}>
      {department === "cleaning" ? "미화·의약품" : "푸드"}
    </span>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: ReportView;
  onChange: (value: ReportView) => void;
}) {
  return (
    <div className="view-toggle" role="tablist" aria-label="현황 보기 구분">
      {reportViewOptions.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? "active" : "ghost"}
          onClick={() => onChange(option.value)}
        >
          <strong>{option.label}</strong>
          <span>{option.description}</span>
        </button>
      ))}
    </div>
  );
}

function ChartLegend({
  showAll = true,
  view,
}: {
  showAll?: boolean;
  view: ReportView;
}) {
  const items = showAll
    ? [
        { label: "추세선", color: CHART_COLORS.trend, type: "line" },
        { label: "합계액", color: CHART_COLORS.total },
        { label: "미화/의약품", color: CHART_COLORS.cleaning },
        { label: "푸드", color: CHART_COLORS.food },
      ]
    : [
        { label: "추세선", color: CHART_COLORS.trend, type: "line" },
        {
          label: reportViewLabel(view),
          color:
            view === "cleaning" ? CHART_COLORS.cleaning : CHART_COLORS.food,
        },
      ];
  return (
    <div className="chart-legend" aria-label="그래프 범례">
      {items.map((item) => (
        <span key={item.label} className="chart-legend-item">
          <i
            className={item.type === "line" ? "legend-line" : "legend-box"}
            style={{
              backgroundColor: item.type === "line" ? undefined : item.color,
              borderColor: item.color,
            }}
          />
          <b>{item.label}</b>
        </span>
      ))}
    </div>
  );
}

function MonthlyUsageTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((entry: any) => entry?.name !== "추세선");
  if (rows.length === 0) return null;

  return (
    <div className="chart-tooltip-box">
      <strong>{label}</strong>
      {rows.map((entry: any) => (
        <div
          key={`${entry.name}-${entry.dataKey}`}
          className="chart-tooltip-row"
        >
          <span
            className="tooltip-color"
            style={{ backgroundColor: entry.color }}
          />
          <span>{entry.name}</span>
          <b>{formatWon(Number(entry.value))}</b>
        </div>
      ))}
    </div>
  );
}

function UploadBox(props: {
  department: Department;
  year: number;
  month: number;
  role: Role;
  uploads: UploadRecord[];
  onUploaded: (file: File, department: Department) => Promise<void>;
}) {
  const { department, year, month, role, uploads, onUploaded } = props;
  const upload = uploads.find(
    (u) => u.year === year && u.month === month && u.department === department,
  );
  const disabled = !canManage(role, department);

  return (
    <div className={`upload-box upload-${department}`}>
      <div className="upload-title-row">
        <div className="upload-mark" aria-hidden="true">
          {department === "cleaning" ? "♧" : "⌁"}
        </div>
        <div>
          <div className="upload-title">
            {departmentLabel(department)} 파일 업로드
          </div>
          <div className="upload-desc">
            {year}년 {month}월 파일을 등록하거나 다시 업로드합니다.
          </div>
        </div>
      </div>
      <label className={disabled ? "upload-drop disabled" : "upload-drop"}>
        <span className="upload-cloud">⇧</span>
        <strong>파일을 드래그하거나 클릭하여 업로드하세요</strong>
        <em>Excel 파일(.xlsx, .xls)만 업로드 가능합니다.</em>
        <input
          type="file"
          accept=".xlsx,.xls"
          disabled={disabled}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (file) await onUploaded(file, department);
            event.target.value = "";
          }}
        />
      </label>
      <div className="upload-meta">
        <span>
          {upload
            ? `최근 업로드: ${new Date(upload.uploadedAt).toLocaleString("ko-KR")}`
            : "최근 업로드: 없음"}
        </span>
        <span>
          {upload
            ? `파일명: ${upload.originalFileName}`
            : "파일을 선택해 주세요"}
        </span>
        <span className={upload ? "meta-ok" : "meta-wait"}>
          {upload ? upload.status : "미등록"}
        </span>
      </div>
    </div>
  );
}

function ValidationSummary({
  issues,
  itemsCount,
}: {
  issues: ValidationIssue[];
  itemsCount: number;
}) {
  const errorCount = issues.filter((issue) => issue.level === "error").length;
  const warningCount = issues.filter(
    (issue) => issue.level === "warning",
  ).length;
  const okCount = Math.max(itemsCount - errorCount - warningCount, 0);
  return (
    <div className="card validation-card">
      <div className="card-title-row">
        <h2>데이터 검증 요약</h2>
        <span>기준: 선택 월</span>
      </div>
      <div className="validation-list">
        <div className="validation-item ok">
          <b>정상</b>
          <strong>{okCount.toLocaleString("ko-KR")}건</strong>
          <small>검증을 통과한 데이터</small>
        </div>
        <div className="validation-item warn">
          <b>경고</b>
          <strong>{warningCount.toLocaleString("ko-KR")}건</strong>
          <small>확인 권장 데이터</small>
        </div>
        <div className="validation-item error">
          <b>오류</b>
          <strong>{errorCount.toLocaleString("ko-KR")}건</strong>
          <small>수정이 필요한 데이터</small>
        </div>
      </div>
    </div>
  );
}

function UploadHistory({ uploads }: { uploads: UploadRecord[] }) {
  const recent = [...uploads]
    .sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt))
    .slice(0, 6);
  return (
    <div className="card">
      <h2>최근 업로드 이력</h2>
      {recent.length === 0 ? (
        <div className="empty">업로드 이력이 없습니다.</div>
      ) : (
        <div className="table-wrap small-table apple-table">
          <table>
            <thead>
              <tr>
                <th>업로드 일시</th>
                <th>구분</th>
                <th>파일명</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((upload) => (
                <tr key={upload.id}>
                  <td>{new Date(upload.uploadedAt).toLocaleString("ko-KR")}</td>
                  <td>
                    <DepartmentBadge department={upload.department} />
                  </td>
                  <td>{upload.originalFileName}</td>
                  <td>
                    <span
                      className={
                        upload.status === "confirmed"
                          ? "status ok"
                          : "status wait"
                      }
                    >
                      {upload.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function IssuesTable({
  issues,
  compact = false,
}: {
  issues: ValidationIssue[];
  compact?: boolean;
}) {
  if (issues.length === 0) {
    return <div className="empty">오류 또는 경고가 없습니다.</div>;
  }

  return (
    <div
      className={
        compact ? "table-wrap small-table compact" : "table-wrap small-table"
      }
    >
      <table>
        <thead>
          <tr>
            <th>수준</th>
            <th>행/NO</th>
            <th>품목명</th>
            <th>유형</th>
            <th>내용</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue) => (
            <tr
              key={issue.id}
              className={issue.level === "error" ? "error-row" : "warning-row"}
            >
              <td>{issue.level === "error" ? "오류" : "경고"}</td>
              <td>{issue.rowNo}</td>
              <td>{issue.itemName}</td>
              <td>{issue.type}</td>
              <td>{issue.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AmountCell({
  value,
  max,
  tone = "default",
}: {
  value: number;
  max: number;
  tone?: "default" | "stock" | "in";
}) {
  const width = max > 0 ? Math.max(4, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="amount-cell">
      <strong>{formatWon(value)}</strong>
      <span className={`microbar ${tone}`}>
        <i style={{ width: `${width}%` }} />
      </span>
    </div>
  );
}


function TopItemsTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="chart-tooltip-box small-tooltip">
      <strong>{entry.name}</strong>
      <div className="chart-tooltip-row single">
        <span
          className="tooltip-color"
          style={{ backgroundColor: entry.payload?.fill ?? entry.color }}
        />
        <span>금액</span>
        <b>{formatWon(Number(entry.value))}</b>
      </div>
    </div>
  );
}

function TopItemsDonut({
  items,
  amountKey,
  title,
}: {
  items: ConsumableItem[];
  amountKey: "usedAmount" | "currentAmount";
  title: string;
}) {
  const donutData = items
    .map((item, index) => ({
      name: item.itemName,
      value: item[amountKey],
      department: item.department,
      fill: DONUT_COLORS[index % DONUT_COLORS.length],
    }))
    .filter((item) => item.value > 0);
  const total = donutData.reduce((sum, item) => sum + item.value, 0);

  if (donutData.length === 0) {
    return <div className="donut-empty">표시할 그래프가 없습니다.</div>;
  }

  return (
    <div className="top-donut-wrap">
      <ResponsiveContainer width="100%" height={210}>
        <PieChart>
          <Tooltip content={<TopItemsTooltip />} />
          <Pie
            data={donutData}
            dataKey="value"
            nameKey="name"
            innerRadius="64%"
            outerRadius="84%"
            paddingAngle={2}
            stroke="#ffffff"
            strokeWidth={3}
            isAnimationActive
            animationBegin={120}
            animationDuration={900}
          >
            {donutData.map((entry, index) => (
              <Cell key={`${entry.name}-${index}`} fill={entry.fill} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="donut-center-label" aria-hidden="true">
        <span>{title}</span>
        <strong>{formatWon(total)}</strong>
      </div>
    </div>
  );
}

function TopItemsCard({
  title,
  items,
  amountKey,
}: {
  title: string;
  items: ConsumableItem[];
  amountKey: "usedAmount" | "currentAmount";
}) {
  return (
    <section className="card top-items-card">
      <div className="section-head">
        <h2>{title}</h2>
        <span className="unit-label">단위: 원</span>
      </div>
      <div className="rank-list readable-list compact-rank-list">
        {items.length === 0 ? (
          <div className="empty">표시할 품목이 없습니다.</div>
        ) : (
          items.map((item, index) => {
            const value = item[amountKey];
            return (
              <div key={item.id} className="rank-row top-rank-row">
                <span>{index + 1}</span>
                <strong title={item.itemName}>{item.itemName}</strong>
                <DepartmentBadge department={item.department} />
                <em>{formatWon(value)}</em>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function AmountStatusTable({ rows }: { rows: AmountRow[] }) {
  const maxUsed = Math.max(...rows.map((row) => row.usedAmount), 0);
  const maxStock = Math.max(...rows.map((row) => row.currentAmount), 0);
  const maxIn = Math.max(...rows.map((row) => row.inAmount), 0);
  return (
    <div className="table-wrap report-table compact-report-table">
      <table>
        <thead>
          <tr>
            <th>구분</th>
            <th>전월 이월 계</th>
            <th>당월 입고 계</th>
            <th>당월 사용 계</th>
            <th>현 재고 계</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className={row.total ? "total-row" : undefined}>
              <td>{row.label}</td>
              <td>{formatWon(row.prevAmount)}</td>
              <td>
                <AmountCell value={row.inAmount} max={maxIn} tone="in" />
              </td>
              <td>
                <AmountCell value={row.usedAmount} max={maxUsed} />
              </td>
              <td>
                <AmountCell
                  value={row.currentAmount}
                  max={maxStock}
                  tone="stock"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  const maxAmount = Math.max(
    ...rows.flatMap((row) => [row.previousUsed, row.currentUsed]),
    0,
  );
  return (
    <div className="table-wrap report-table compact-report-table">
      <table>
        <thead>
          <tr>
            <th>구분</th>
            <th>전월 사용금액</th>
            <th>당월 사용금액</th>
            <th>차액</th>
            <th>증감률</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className={row.total ? "total-row" : undefined}>
              <td>{row.label}</td>
              <td>
                <AmountCell value={row.previousUsed} max={maxAmount} tone="stock" />
              </td>
              <td>
                <AmountCell value={row.currentUsed} max={maxAmount} />
              </td>
              <td className={row.diff >= 0 ? "plus" : "minus"}>
                {formatWon(row.diff)}
              </td>
              <td>{row.rate === null ? "-" : formatPercent(row.rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function itemClassification(item: ConsumableItem) {
  return item.middleCategory || item.majorCategory || item.subCategory || "-";
}

function compareDepartment(a: Department, b: Department) {
  if (a === b) return 0;
  return a === "cleaning" ? -1 : 1;
}

function DetailStatusTable({ items }: { items: ConsumableItem[] }) {
  const [filterDepartment, setFilterDepartment] = useState<ReportView>("all");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [sortMode, setSortMode] = useState<
    "default" | "usedDesc" | "stockDesc"
  >("default");
  const [stockFilter, setStockFilter] = useState<
    "all" | "hasStock" | "noStock"
  >("all");

  const rows = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();

    return [...items]
      .filter(
        (item) =>
          filterDepartment === "all" || item.department === filterDepartment,
      )
      .filter((item) => {
        if (!keyword) return true;
        return [
          item.itemName,
          item.specification,
          item.unit,
          item.location,
          item.majorCategory,
          item.middleCategory,
          item.subCategory,
        ]
          .join(" ")
          .toLowerCase()
          .includes(keyword);
      })
      .filter((item) => {
        if (stockFilter === "hasStock")
          return item.currentQty > 0 || item.currentAmount > 0;
        if (stockFilter === "noStock")
          return item.currentQty <= 0 && item.currentAmount <= 0;
        return true;
      })
      .sort((a, b) => {
        if (sortMode === "usedDesc") return b.usedAmount - a.usedAmount;
        if (sortMode === "stockDesc") return b.currentAmount - a.currentAmount;

        const dept = compareDepartment(a.department, b.department);
        if (dept !== 0) return dept;

        const itemCompare = a.itemName.localeCompare(b.itemName, "ko-KR");
        if (itemCompare !== 0) return itemCompare;

        return (a.location || "").localeCompare(b.location || "", "ko-KR");
      });
  }, [items, filterDepartment, searchKeyword, sortMode, stockFilter]);

  const totals = rows.reduce(
    (acc, item) => ({
      usedAmount: acc.usedAmount + item.usedAmount,
      currentAmount: acc.currentAmount + item.currentAmount,
    }),
    { usedAmount: 0, currentAmount: 0 },
  );

  return (
    <div className="detail-status-wrap">
      <div className="detail-filters no-print">
        <label>
          구분
          <select
            value={filterDepartment}
            onChange={(event) =>
              setFilterDepartment(event.target.value as ReportView)
            }
          >
            <option value="all">전체</option>
            <option value="cleaning">미화/의약품</option>
            <option value="food">푸드</option>
          </select>
        </label>
        <label className="detail-search-label">
          품목명 검색
          <input
            type="search"
            placeholder="품목명, 장소 검색"
            value={searchKeyword}
            onChange={(event) => setSearchKeyword(event.target.value)}
          />
        </label>
        <label>
          정렬
          <select
            value={sortMode}
            onChange={(event) =>
              setSortMode(
                event.target.value as "default" | "usedDesc" | "stockDesc",
              )
            }
          >
            <option value="default">구분·품목명 가나다순</option>
            <option value="usedDesc">사용금액 높은순</option>
            <option value="stockDesc">재고금액 높은순</option>
          </select>
        </label>
        <label>
          재고 여부
          <select
            value={stockFilter}
            onChange={(event) =>
              setStockFilter(
                event.target.value as "all" | "hasStock" | "noStock",
              )
            }
          >
            <option value="all">전체</option>
            <option value="hasStock">재고 있음</option>
            <option value="noStock">재고 없음</option>
          </select>
        </label>
      </div>

      <div className="table-wrap detail-table">
        <table>
          <thead>
            <tr>
              <th>No.</th>
              <th>구분</th>
              <th>품목명</th>
              <th>단위</th>
              <th>장소</th>
              <th>전월 이월</th>
              <th>당월 입고</th>
              <th>당월 사용</th>
              <th>현 재고</th>
              <th>단가</th>
              <th>사용금액</th>
              <th>재고금액</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="empty-cell">
                  표시할 품목 현황이 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((item, index) => (
                <tr key={item.id}>
                  <td className="detail-no">{index + 1}</td>
                  <td>
                    <DepartmentBadge department={item.department} />
                  </td>
                  <td className="detail-name">{item.itemName}</td>
                  <td className="center-cell">{item.unit || "-"}</td>
                  <td className="detail-location">{item.location || "-"}</td>
                  <td className="qty-cell">{formatNumber(item.prevQty, 2)}</td>
                  <td className="qty-cell">{formatNumber(item.inQty, 2)}</td>
                  <td className="qty-cell">{formatNumber(item.usedQty, 2)}</td>
                  <td className="qty-cell">{formatNumber(item.currentQty, 2)}</td>
                  <td className="money-cell">{formatWon(item.unitPrice)}</td>
                  <td className="money-cell">{formatWon(item.usedAmount)}</td>
                  <td className="money-cell">{formatWon(item.currentAmount)}</td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={10} className="money-cell">합계</td>
                <td className="money-cell">{formatWon(totals.usedAmount)}</td>
                <td className="money-cell">{formatWon(totals.currentAmount)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function EditableCell(props: {
  item: ConsumableItem;
  field: EditableField;
  disabled: boolean;
  onChange: (itemId: string, field: EditableField, value: string) => void;
}) {
  const { item, field, disabled, onChange } = props;
  const value = item[field];
  return (
    <input
      className="cell-input"
      disabled={disabled}
      value={String(value ?? "")}
      onChange={(event) => onChange(item.id, field, event.target.value)}
    />
  );
}

export default function DashboardApp(
  _props: { initialRole?: Role; lockRole?: boolean } = {},
) {
  const [role, setRole] = useState<Role>("viewer");
  const [screen, setScreen] = useState<Screen>("report");
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(1);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [items, setItems] = useState<ConsumableItem[]>([]);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [reportView, setReportView] = useState<ReportView>("all");
  const [manageDepartment, setManageDepartment] = useState<ReportView>("all");
  const [message, setMessage] = useState("");
  const [hasAutoSelectedLatest, setHasAutoSelectedLatest] = useState(false);

  async function reload() {
    const data = await loadAllData();
    setUploads(data.uploads);
    setItems(data.items);
    setIssues(data.issues);
    setAuditLogs(data.auditLogs ?? []);
  }

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    if (!adminUnlocked) {
      setRole("viewer");
      setManageDepartment("all");
    } else {
      setRole("admin");
    }
  }, [adminUnlocked]);

  useEffect(() => {
    if (hasAutoSelectedLatest) return;
    const candidates = [
      ...uploads.map((upload) => ({ year: upload.year, month: upload.month })),
      ...items.map((item) => ({ year: item.year, month: item.month })),
    ];
    if (candidates.length === 0) return;
    const latest = candidates.reduce((max, current) =>
      current.year > max.year ||
      (current.year === max.year && current.month > max.month)
        ? current
        : max,
    );
    setYear(latest.year);
    setMonth(latest.month);
    setHasAutoSelectedLatest(true);
  }, [uploads, items, hasAutoSelectedLatest]);

  const reportItems = useMemo(
    () =>
      reportView === "all"
        ? items
        : items.filter((item) => item.department === reportView),
    [items, reportView],
  );

  const reportSummaries = useMemo(
    () => buildMonthlySummaries(reportItems),
    [reportItems],
  );
  const fullSummaries = useMemo(() => buildMonthlySummaries(items), [items]);
  const selectedSummaryIndex = reportSummaries.findIndex(
    (s) => s.year === year && s.month === month,
  );
  const selectedSummary =
    selectedSummaryIndex >= 0
      ? reportSummaries[selectedSummaryIndex]
      : undefined;
  const previousSummary =
    selectedSummaryIndex > 0
      ? reportSummaries[selectedSummaryIndex - 1]
      : undefined;
  const selectedFullSummary = fullSummaries.find(
    (s) => s.year === year && s.month === month,
  );
  const previousFullSummary = findPreviousSummary(fullSummaries, year, month);
  const comparisonCurrent =
    reportView === "all" ? selectedFullSummary : selectedSummary;
  const comparisonPrevious =
    reportView === "all" ? previousFullSummary : previousSummary;
  const reportCurrentItems = reportItems.filter(
    (item) => item.year === year && item.month === month,
  );
  const reportCurrentAllItems = items.filter(
    (item) => item.year === year && item.month === month,
  );
  const amountRows = buildAmountRows(reportCurrentAllItems, reportView);
  const currentTotals = sumAmounts(reportCurrentItems);
  const currentCleaningTotals = sumAmounts(
    reportCurrentAllItems.filter((item) => item.department === "cleaning"),
  );
  const currentFoodTotals = sumAmounts(
    reportCurrentAllItems.filter((item) => item.department === "food"),
  );
  const comparisonRows = buildComparisonRows(
    comparisonCurrent,
    comparisonPrevious,
    reportView,
  );
  const summaryComparisonRow =
    comparisonRows.find((row) => row.total) ?? comparisonRows[0];

  const manageItems = items.filter((item) => {
    const sameMonth = item.year === year && item.month === month;
    const sameDepartment =
      manageDepartment === "all" || item.department === manageDepartment;
    return sameMonth && sameDepartment;
  });
  const manageIssues = issues.filter((issue) => {
    const upload = uploads.find((u) => u.id === issue.uploadId);
    const sameMonth = upload?.year === year && upload?.month === month;
    const sameDepartment =
      manageDepartment === "all" || upload?.department === manageDepartment;
    return Boolean(sameMonth && sameDepartment);
  });
  const allCurrentIssues = issues.filter((issue) => {
    const upload = uploads.find((u) => u.id === issue.uploadId);
    return upload?.year === year && upload?.month === month;
  });

  const usedItemCount = reportCurrentItems.filter(
    (item) => item.usedQty > 0 || item.usedAmount > 0,
  ).length;
  const stockItemCount = reportCurrentItems.filter(
    (item) => item.currentQty > 0 || item.currentAmount > 0,
  ).length;
  const topUsed = getTopUsedItems(reportItems, year, month, 10);
  const topStock = getTopStockItems(reportItems, year, month, 10);
  const analysis = getMonthAnalysis(reportSummaries, year, month);

  const reportTrendData = reportSummaries.map((summary) => ({
    ...summary,
    label: `${summary.month}월`,
  }));
  const monthlyBarData = reportTrendData.map((summary) => ({
    ...summary,
    trendUsed:
      reportView === "cleaning"
        ? summary.cleaningUsed
        : reportView === "food"
          ? summary.foodUsed
          : summary.totalUsed,
    selectedUsed:
      reportView === "cleaning"
        ? summary.cleaningUsed
        : reportView === "food"
          ? summary.foodUsed
          : summary.totalUsed,
  }));

  function openReport() {
    setScreen("report");
  }

  function openAdmin() {
    if (adminUnlocked) {
      setScreen("manage");
      setManageDepartment("all");
      return;
    }
    setScreen("login");
    setLoginError("");
  }

  async function handleAdminLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginLoading(true);
    setLoginError("");
    try {
      const response = await fetch("/api/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPassword }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        setLoginError("비밀번호가 일치하지 않습니다.");
        return;
      }
      setAdminUnlocked(true);
      setRole("admin");
      setScreen("manage");
      setManageDepartment("all");
      setAdminPassword("");
    } catch {
      setLoginError("관리자 접속 확인 중 오류가 발생했습니다.");
    } finally {
      setLoginLoading(false);
    }
  }

  function logoutAdmin() {
    setAdminUnlocked(false);
    setRole("viewer");
    setScreen("report");
    setManageDepartment("all");
  }

  async function handleUpload(file: File, department: Department) {
    try {
      const existing = uploads.find(
        (u) =>
          u.year === year && u.month === month && u.department === department,
      );
      if (existing?.status === "confirmed" && role !== "admin") {
        setMessage(
          "이미 확정된 월 데이터입니다. 관리자만 다시 업로드할 수 있습니다.",
        );
        return;
      }
      if (existing) {
        const ok = window.confirm(
          `${year}년 ${month}월 ${departmentLabel(department)} 데이터가 이미 있습니다. 기존 데이터를 덮어쓸까요?`,
        );
        if (!ok) return;
      }

      const parsed = await parseConsumableExcel({
        file,
        year,
        month,
        department,
      });
      await saveUploadResult(parsed, file);
      await reload();
      setMessage(
        `${departmentLabel(department)} 파일 업로드가 완료되었습니다. 오류 ${parsed.issues.filter((i) => i.level === "error").length}건, 경고 ${parsed.issues.filter((i) => i.level === "warning").length}건이 확인되었습니다.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "업로드 중 오류가 발생했습니다.",
      );
    }
  }

  async function handleCellChange(
    itemId: string,
    field: EditableField,
    rawValue: string,
  ) {
    const target = items.find((item) => item.id === itemId);
    if (!target) return;
    const oldValue = String(target[field] ?? "");
    const numericFields: EditableField[] = [
      "prevQty",
      "inQty",
      "currentQty",
      "unitPrice",
    ];
    const parsedValue = numericFields.includes(field)
      ? Number(String(rawValue).replace(/,/g, "")) || 0
      : rawValue;

    const updatedItems = items.map((item) => {
      if (item.id !== itemId) return item;
      return recalculateItem({ ...item, [field]: parsedValue });
    });
    setItems(updatedItems);

    const edited = updatedItems.find((item) => item.id === itemId)!;
    const uploadIssues = validateItems(
      edited.uploadId,
      updatedItems.filter((item) => item.uploadId === edited.uploadId),
    );
    const newIssues = [
      ...issues.filter((issue) => issue.uploadId !== edited.uploadId),
      ...uploadIssues,
    ];
    setIssues(newIssues);

    await saveItems(updatedItems);
    await saveIssues(newIssues);

    if (oldValue !== String(parsedValue)) {
      const log: AuditLog = {
        id: crypto.randomUUID(),
        itemId,
        fieldName: field,
        oldValue,
        newValue: String(parsedValue),
        editedAt: new Date().toISOString(),
      };
      const nextLogs = [log, ...auditLogs].slice(0, 200);
      setAuditLogs(nextLogs);
      await saveAuditLog(log);
    }
  }

  async function confirmCurrentMonth() {
    if (role !== "admin") {
      setMessage("월별 확정은 관리자만 가능합니다.");
      return;
    }
    const hasError = allCurrentIssues.some((issue) => issue.level === "error");
    if (hasError) {
      setMessage(
        "error 수준의 오류가 있어 확정할 수 없습니다. 오류를 수정한 뒤 다시 확정해주세요.",
      );
      return;
    }
    const newUploads = uploads.map((upload) =>
      upload.year === year && upload.month === month
        ? {
            ...upload,
            status: "confirmed" as const,
            updatedAt: new Date().toISOString(),
          }
        : upload,
    );
    setUploads(newUploads);
    await saveUploads(newUploads);
    setMessage(`${year}년 ${month}월 데이터가 확정되었습니다.`);
  }

  function printReport() {
    window.print();
  }

  const readOnlyReport = screen === "report";
  const showLogin = screen === "login";
  const showManage = screen === "manage" && adminUnlocked;

  return (
    <div
      className={
        readOnlyReport ? "saas-shell report-mode" : "saas-shell manage-mode"
      }
    >
      <AppHeader
        screen={screen}
        adminUnlocked={adminUnlocked}
        onOpenReport={openReport}
        onOpenAdmin={openAdmin}
      />
      <main className="page-content">
        {!showLogin && (
          <section className="topbar no-print">
            <div className="page-heading">
              <span className="eyebrow">PA센터 {TEAM_NAME}</span>
              <h1>{readOnlyReport ? "소모품 운영현황" : "데이터 관리"}</h1>
              <p>
                {readOnlyReport
                  ? "소모품 사용 및 재고 현황을 한눈에 확인할 수 있습니다."
                  : "소모품 데이터를 업로드하고 검증 결과를 확인하여 운영 데이터의 정확성과 품질을 관리합니다."}
              </p>
            </div>
            <div className="topbar-actions">
              <label className="compact-field">
                연도
                <input
                  type="number"
                  value={year}
                  onChange={(event) => setYear(Number(event.target.value))}
                />
              </label>
              <label className="compact-field">
                월
                <select
                  value={month}
                  onChange={(event) => setMonth(Number(event.target.value))}
                >
                  {Array.from({ length: 12 }, (_, index) => index + 1).map(
                    (m) => (
                      <option key={m} value={m}>
                        {m}월
                      </option>
                    ),
                  )}
                </select>
              </label>
              <button
                className="hero-button"
                onClick={() =>
                  exportItemsToWorkbook(
                    readOnlyReport ? reportCurrentItems : manageItems,
                  )
                }
              >
                엑셀 다운로드
              </button>
              <button className="hero-button" onClick={printReport}>
                PDF 출력
              </button>
              {showManage && role === "admin" && (
                <button
                  className="hero-button primary"
                  onClick={confirmCurrentMonth}
                >
                  월 데이터 확정
                </button>
              )}
            </div>
          </section>
        )}

        {message && <div className="message no-print">{message}</div>}

        {showLogin && (
          <section className="login-panel no-print">
            <div className="login-card">
              <div className="login-copy">
                <span className="login-kicker">Admin Access</span>
                <h2>관리자 비밀번호를 입력해 주세요.</h2>
                <p>
                  업로드, 데이터 수정, 월 데이터 확정 기능은 관리자 인증 후
                  사용할 수 있습니다.
                </p>
              </div>
              <form className="login-form" onSubmit={handleAdminLogin}>
                <label>
                  비밀번호
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(event) => setAdminPassword(event.target.value)}
                    placeholder="관리자 비밀번호를 입력하세요"
                    autoFocus
                  />
                </label>
                {loginError && <div className="login-error">{loginError}</div>}
                <div className="login-actions">
                  <button
                    type="button"
                    className="hero-button"
                    onClick={openReport}
                  >
                    운영현황으로 돌아가기
                  </button>
                  <button
                    type="submit"
                    className="hero-button primary"
                    disabled={loginLoading}
                  >
                    {loginLoading ? "확인 중" : "접속하기"}
                  </button>
                </div>
              </form>
            </div>
          </section>
        )}

        {readOnlyReport && (
          <>
            <section className="view-card no-print">
              <div>
                <h2>현황 보기 선택</h2>
                <p>
                  선택한 기준에 따라 금액, 그래프, 상위 품목과 세부현황이 함께
                  바뀝니다.
                </p>
              </div>
              <ViewToggle value={reportView} onChange={setReportView} />
            </section>

            <section className="kpi-grid report-kpis">
              <KpiCard
                icon="◷"
                title="당월 사용금액"
                value={formatWon(currentTotals.usedAmount)}
                sub={`${summaryComparisonRow ? `전월 대비 ${summaryComparisonRow.rate === null ? "-" : formatPercent(summaryComparisonRow.rate)}` : "전월 비교 없음"}`}
              />
              <KpiCard
                icon="◴"
                title="전월 사용금액"
                value={formatWon(summaryComparisonRow?.previousUsed ?? 0)}
                sub="비교 기준월 사용금액"
              />
              <KpiCard
                icon="▥"
                title="월간 평균 사용금액"
                value={formatWon(
                  reportSummaries.length
                    ? reportSummaries.reduce(
                        (sum, item) => sum + valueForView(item, reportView),
                        0,
                      ) / reportSummaries.length
                    : 0,
                )}
                sub={`${reportSummaries.length.toLocaleString("ko-KR")}개월 기준`}
              />
              <KpiCard
                icon="□"
                title="현재 재고금액"
                value={formatWon(currentTotals.currentAmount)}
                sub={`등록 품목 ${reportCurrentItems.length.toLocaleString("ko-KR")}개`}
              />
            </section>

            <section className="card chart-card wide-chart report-section">
              <div className="section-head">
                <div>
                  <h2>1. 월별 사용금액 추이</h2>
                  <p>
                    {reportView === "all"
                      ? "합계액, 미화·의약품, 푸드 사용금액과 추세선을 월별로 비교합니다."
                      : `${reportViewLabel(reportView)} 사용금액과 추세선을 월별로 확인합니다.`}
                  </p>
                </div>
                <span className="unit-label">단위: 원</span>
              </div>
              <ChartLegend showAll={reportView === "all"} view={reportView} />
              <ResponsiveContainer width="100%" height={330}>
                <ComposedChart
                  key={`trend-${reportView}-${year}-${month}-${monthlyBarData.length}`}
                  data={monthlyBarData}
                  barCategoryGap="20%"
                  barGap={5}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(15,23,42,0.10)"
                  />
                  <XAxis dataKey="label" />
                  <YAxis
                    tickFormatter={(value) =>
                      `${Math.round(Number(value) / 10000)}만`
                    }
                  />
                  <Tooltip content={<MonthlyUsageTooltip />} />
                  {reportView === "all" ? (
                    <>
                      <Bar
                        dataKey="totalUsed"
                        name="합계액"
                        fill={CHART_COLORS.total}
                        radius={[7, 7, 0, 0]}
                        isAnimationActive
                        animationBegin={80}
                        animationDuration={850}
                      />
                      <Bar
                        dataKey="cleaningUsed"
                        name="미화/의약품"
                        fill={CHART_COLORS.cleaning}
                        radius={[7, 7, 0, 0]}
                        isAnimationActive
                        animationBegin={160}
                        animationDuration={850}
                      />
                      <Bar
                        dataKey="foodUsed"
                        name="푸드"
                        fill={CHART_COLORS.food}
                        radius={[7, 7, 0, 0]}
                        isAnimationActive
                        animationBegin={240}
                        animationDuration={850}
                      />
                      <Line
                        type="monotone"
                        dataKey="trendUsed"
                        name="추세선"
                        stroke={CHART_COLORS.trend}
                        strokeWidth={2.5}
                        strokeDasharray="5 5"
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                        isAnimationActive
                        animationBegin={320}
                        animationDuration={950}
                      />
                    </>
                  ) : (
                    <>
                      <Bar
                        dataKey="selectedUsed"
                        name={reportViewLabel(reportView)}
                        fill={
                          reportView === "cleaning"
                            ? CHART_COLORS.cleaning
                            : CHART_COLORS.food
                        }
                        radius={[7, 7, 0, 0]}
                        isAnimationActive
                        animationBegin={80}
                        animationDuration={850}
                      />
                      <Line
                        type="monotone"
                        dataKey="trendUsed"
                        name="추세선"
                        stroke={CHART_COLORS.trend}
                        strokeWidth={2.5}
                        strokeDasharray="5 5"
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                        isAnimationActive
                        animationBegin={180}
                        animationDuration={950}
                      />
                    </>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
              <div className="analysis-strip">
                <b>자동 분석 코멘트</b>
                <p>{analysis}</p>
              </div>
            </section>

            <section className="grid two report-section compact-grid">
              <div className="card report-section compact-card">
                <div className="section-head">
                  <div>
                    <h2>2. 월간 수불 현황</h2>
                    <p>
                      전월 이월, 당월 입고, 당월 사용, 현 재고를 정리합니다.
                    </p>
                  </div>
                  <span className="unit-label">단위: 원</span>
                </div>
                <AmountStatusTable rows={amountRows} />
              </div>

              <div className="card report-section compact-card">
                <div className="section-head">
                  <div>
                    <h2>3. 월별 사용금액 비교</h2>
                    <p>전월 사용금액과 당월 사용금액을 비교합니다.</p>
                  </div>
                  <span className="unit-label">단위: 원</span>
                </div>
                <ComparisonTable rows={comparisonRows} />
              </div>
            </section>

            <section className="grid two top-items-grid report-section">
              <TopItemsCard
                title="4. 사용금액 상위 10개 품목"
                items={topUsed}
                amountKey="usedAmount"
              />

              <TopItemsCard
                title="5. 재고금액 상위 10개 품목"
                items={topStock}
                amountKey="currentAmount"
              />
            </section>

            <section className="card summary-mini summary-wide report-section">
              <div className="section-head">
                <div>
                  <h2>6. 현황 요약</h2>
                  <p>선택한 월의 전체 품목, 사용 품목, 재고 보유 품목을 요약합니다.</p>
                </div>
              </div>
              <div className="mini-stats">
                <div>
                  <b>{reportCurrentItems.length}</b>
                  <span>전체 품목 수</span>
                </div>
                <div>
                  <b>{usedItemCount}</b>
                  <span>사용 품목 수</span>
                </div>
                <div>
                  <b>{stockItemCount}</b>
                  <span>재고 보유 품목 수</span>
                </div>
              </div>
            </section>

            <section className="card report-section detail-section">
              <div className="section-head">
                <div>
                  <h2>7. 품목별 세부 현황</h2>
                  <p>
                    {year}년 {month}월 품목별 현황을 구분과 품목명 가나다순으로
                    정리합니다.
                  </p>
                </div>
                <span className="unit-label">
                  총 {reportCurrentItems.length.toLocaleString("ko-KR")}건
                </span>
              </div>
              <DetailStatusTable items={reportCurrentItems} />
            </section>
          </>
        )}
        {showManage && (
          <>
            <section className="manager-toolbar no-print">
              <div>
                <h2>데이터 관리 범위 선택</h2>
                <p>선택한 관리 범위에 맞는 업로드와 수정 기능만 표시합니다.</p>
              </div>
              <div className="manage-segment">
                <button
                  type="button"
                  className={manageDepartment === "all" ? "active" : "ghost"}
                  onClick={() => setManageDepartment("all")}
                >
                  종합 데이터 관리
                </button>
                <button
                  type="button"
                  className={
                    manageDepartment === "cleaning" ? "active" : "ghost"
                  }
                  onClick={() => setManageDepartment("cleaning")}
                >
                  미화·의약품 관리
                </button>
                <button
                  type="button"
                  className={manageDepartment === "food" ? "active" : "ghost"}
                  onClick={() => setManageDepartment("food")}
                >
                  푸드 관리
                </button>
              </div>
              <button
                type="button"
                className="hero-button"
                onClick={logoutAdmin}
              >
                관리자 접속 종료
              </button>
            </section>

            <section className="manage-upload-grid">
              {(manageDepartment === "all" ||
                manageDepartment === "cleaning") && (
                <UploadBox
                  department="cleaning"
                  year={year}
                  month={month}
                  role={role}
                  uploads={uploads}
                  onUploaded={handleUpload}
                />
              )}
              {(manageDepartment === "all" || manageDepartment === "food") && (
                <UploadBox
                  department="food"
                  year={year}
                  month={month}
                  role={role}
                  uploads={uploads}
                  onUploaded={handleUpload}
                />
              )}
              <ValidationSummary
                issues={manageIssues}
                itemsCount={manageItems.length}
              />
            </section>

            <section className="manage-stack">
              <UploadHistory uploads={uploads} />
              <section className="card">
                <div className="section-head">
                  <div>
                    <h2>검증 리포트</h2>
                    <p>검증 결과 중 수정이 필요한 항목을 확인합니다.</p>
                  </div>
                </div>
                <IssuesTable issues={manageIssues} compact />
              </section>
            </section>

            <section className="card">
              <div className="section-head">
                <div>
                  <h2>업로드 데이터 수정</h2>
                  <p>
                    전월 이월량, 당월 입고량, 현 재고, 단가를 수정하면 사용량과
                    금액이 자동 재계산됩니다.
                  </p>
                </div>
                <div className="small-note">
                  확정된 월은 담당자 수정이 제한됩니다.
                </div>
              </div>
              <div className="table-wrap edit-table">
                <table>
                  <thead>
                    <tr>
                      <th>구분</th>
                      <th>NO</th>
                      <th>중분류</th>
                      <th>품목명</th>
                      <th>규격</th>
                      <th>단위</th>
                      <th>장소</th>
                      <th>전월 이월</th>
                      <th>입고</th>
                      <th>사용</th>
                      <th>현 재고</th>
                      <th>단가</th>
                      <th>사용금액</th>
                      <th>재고금액</th>
                      <th>비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {manageItems.map((item) => {
                      const upload = uploads.find(
                        (u) => u.id === item.uploadId,
                      );
                      const disabled = Boolean(
                        (upload?.status === "confirmed" && role !== "admin") ||
                        !canManage(role, item.department),
                      );
                      return (
                        <tr key={item.id}>
                          <td>{departmentLabel(item.department)}</td>
                          <td>{item.no}</td>
                          <td>{item.middleCategory}</td>
                          <td>
                            <EditableCell
                              item={item}
                              field="itemName"
                              disabled={disabled}
                              onChange={handleCellChange}
                            />
                          </td>
                          <td>
                            <EditableCell
                              item={item}
                              field="specification"
                              disabled={disabled}
                              onChange={handleCellChange}
                            />
                          </td>
                          <td>
                            <EditableCell
                              item={item}
                              field="unit"
                              disabled={disabled}
                              onChange={handleCellChange}
                            />
                          </td>
                          <td>
                            <EditableCell
                              item={item}
                              field="location"
                              disabled={disabled}
                              onChange={handleCellChange}
                            />
                          </td>
                          <td>
                            <EditableCell
                              item={item}
                              field="prevQty"
                              disabled={disabled}
                              onChange={handleCellChange}
                            />
                          </td>
                          <td>
                            <EditableCell
                              item={item}
                              field="inQty"
                              disabled={disabled}
                              onChange={handleCellChange}
                            />
                          </td>
                          <td>{formatNumber(item.usedQty, 2)}</td>
                          <td>
                            <EditableCell
                              item={item}
                              field="currentQty"
                              disabled={disabled}
                              onChange={handleCellChange}
                            />
                          </td>
                          <td>
                            <EditableCell
                              item={item}
                              field="unitPrice"
                              disabled={disabled}
                              onChange={handleCellChange}
                            />
                          </td>
                          <td>{formatWon(item.usedAmount)}</td>
                          <td>{formatWon(item.currentAmount)}</td>
                          <td>
                            <EditableCell
                              item={item}
                              field="note"
                              disabled={disabled}
                              onChange={handleCellChange}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="card">
              <h2>최근 수정 이력</h2>
              {auditLogs.length === 0 ? (
                <div className="empty">수정 이력이 없습니다.</div>
              ) : (
                <div className="table-wrap small-table">
                  <table>
                    <thead>
                      <tr>
                        <th>수정일시</th>
                        <th>품목</th>
                        <th>항목</th>
                        <th>수정 전</th>
                        <th>수정 후</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.slice(0, 20).map((log) => {
                        const item = items.find((i) => i.id === log.itemId);
                        return (
                          <tr key={log.id}>
                            <td>
                              {new Date(log.editedAt).toLocaleString("ko-KR")}
                            </td>
                            <td>{item?.itemName ?? "-"}</td>
                            <td>{String(log.fieldName)}</td>
                            <td>{log.oldValue}</td>
                            <td>{log.newValue}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
