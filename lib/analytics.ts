import type { ConsumableItem, MonthlySummary } from "./types";

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function buildMonthlySummaries(items: ConsumableItem[]): MonthlySummary[] {
  const map = new Map<string, MonthlySummary>();

  items.forEach((item) => {
    const key = monthKey(item.year, item.month);
    const current = map.get(key) ?? {
      year: item.year,
      month: item.month,
      cleaningUsed: 0,
      foodUsed: 0,
      totalUsed: 0,
      cleaningStock: 0,
      foodStock: 0,
      totalStock: 0,
      totalInAmount: 0
    };

    if (item.department === "cleaning") {
      current.cleaningUsed += item.usedAmount;
      current.cleaningStock += item.currentAmount;
    } else {
      current.foodUsed += item.usedAmount;
      current.foodStock += item.currentAmount;
    }

    current.totalUsed += item.usedAmount;
    current.totalStock += item.currentAmount;
    current.totalInAmount += item.inAmount;
    map.set(key, current);
  });

  return Array.from(map.values()).sort((a, b) => a.year - b.year || a.month - b.month);
}

export function getTopUsedItems(items: ConsumableItem[], year: number, month: number, limit = 10) {
  return items
    .filter(
      (item) =>
        item.year === year &&
        item.month === month &&
        (item.usedQty > 0 || item.usedAmount > 0),
    )
    .sort((a, b) => b.usedAmount - a.usedAmount)
    .slice(0, limit);
}

export function getTopStockItems(items: ConsumableItem[], year: number, month: number, limit = 10) {
  return items
    .filter(
      (item) =>
        item.year === year &&
        item.month === month &&
        (item.currentQty > 0 || item.currentAmount > 0),
    )
    .sort((a, b) => b.currentAmount - a.currentAmount)
    .slice(0, limit);
}

export function getMonthAnalysis(summaries: MonthlySummary[], year: number, month: number) {
  const currentIndex = summaries.findIndex((s) => s.year === year && s.month === month);
  if (currentIndex < 0) return "선택한 월의 데이터가 없습니다. 미화 또는 푸드 파일을 업로드해주세요.";

  const current = summaries[currentIndex];
  const previous = summaries[currentIndex - 1];

  if (!previous) {
    return `${year}년 ${month}월은 등록된 첫 월 데이터입니다. 총 사용금액은 ${Math.round(current.totalUsed).toLocaleString("ko-KR")}원이며, 이후 월부터 전월 대비 증감 분석이 가능합니다.`;
  }

  const diff = current.totalUsed - previous.totalUsed;
  const rate = previous.totalUsed === 0 ? 0 : (diff / previous.totalUsed) * 100;
  const direction = diff >= 0 ? "증가" : "감소";
  return `${year}년 ${month}월 총 사용금액은 ${Math.round(current.totalUsed).toLocaleString("ko-KR")}원으로 전월 대비 ${Math.abs(Math.round(diff)).toLocaleString("ko-KR")}원(${Math.abs(rate).toFixed(1)}%) ${direction}했습니다.`;
}

export function getCurrentMonth(summaries: MonthlySummary[]) {
  return summaries.at(-1) ?? null;
}
