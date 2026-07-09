export function formatWon(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0
  }).format(Math.round(value || 0));
}

export function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: digits
  }).format(value || 0);
}

export function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function departmentLabel(department: "cleaning" | "food") {
  return department === "cleaning" ? "미화·의약품" : "푸드";
}
