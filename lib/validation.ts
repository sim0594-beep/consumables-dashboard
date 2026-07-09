import type { ConsumableItem, ValidationIssue } from "./types";

const QTY_TOLERANCE = 0.05;
const AMOUNT_TOLERANCE = 5;

function issue(params: Omit<ValidationIssue, "id">): ValidationIssue {
  return { id: crypto.randomUUID(), ...params };
}

function near(a: number, b: number, tolerance: number) {
  return Math.abs((a || 0) - (b || 0)) <= tolerance;
}

function rowNo(item: ConsumableItem, index: number) {
  return typeof item.no === "number" ? item.no : index + 1;
}

export function recalculateItem(item: ConsumableItem): ConsumableItem {
  const usedQty = Number(item.prevQty || 0) + Number(item.inQty || 0) - Number(item.currentQty || 0);
  return {
    ...item,
    usedQty,
    prevAmount: Number(item.prevQty || 0) * Number(item.unitPrice || 0),
    inAmount: Number(item.inQty || 0) * Number(item.unitPrice || 0),
    usedAmount: usedQty * Number(item.unitPrice || 0),
    currentAmount: Number(item.currentQty || 0) * Number(item.unitPrice || 0)
  };
}

export function validateItems(uploadId: string, items: ConsumableItem[]) {
  const issues: ValidationIssue[] = [];
  const duplicateMap = new Map<string, number[]>();

  items.forEach((item, index) => {
    const rn = rowNo(item, index);
    const key = [item.itemName, item.specification, item.location]
      .map((v) => String(v || "").trim())
      .join("|");
    duplicateMap.set(key, [...(duplicateMap.get(key) ?? []), rn]);

    if (!item.itemName) {
      issues.push(issue({
        uploadId,
        rowNo: rn,
        itemName: "",
        level: "error",
        type: "필수값 누락",
        message: "품목명이 비어 있습니다."
      }));
    }

    if (item.currentQty < 0) {
      issues.push(issue({
        uploadId,
        rowNo: rn,
        itemName: item.itemName,
        level: "error",
        type: "음수 재고",
        message: "현 재고가 0보다 작습니다. 재고 수량을 확인해주세요."
      }));
    }

    if (item.unitPrice < 0) {
      issues.push(issue({
        uploadId,
        rowNo: rn,
        itemName: item.itemName,
        level: "error",
        type: "단가 오류",
        message: "단가가 0보다 작습니다. 단가를 확인해주세요."
      }));
    }

    const expectedUsedQty = item.prevQty + item.inQty - item.currentQty;
    if (!near(expectedUsedQty, item.usedQty, QTY_TOLERANCE)) {
      issues.push(issue({
        uploadId,
        rowNo: rn,
        itemName: item.itemName,
        level: "error",
        type: "사용량 계산 오류",
        message: `당월 사용량이 맞지 않습니다. 예상 사용량은 ${expectedUsedQty.toFixed(2)}입니다.`
      }));
    }

    const amountChecks = [
      ["전월 이월금액", item.prevAmount, item.prevQty * item.unitPrice],
      ["당월 입고금액", item.inAmount, item.inQty * item.unitPrice],
      ["당월 사용금액", item.usedAmount, item.usedQty * item.unitPrice],
      ["현 재고금액", item.currentAmount, item.currentQty * item.unitPrice]
    ] as const;

    amountChecks.forEach(([label, actual, expected]) => {
      if (!near(actual, expected, AMOUNT_TOLERANCE)) {
        issues.push(issue({
          uploadId,
          rowNo: rn,
          itemName: item.itemName,
          level: "warning",
          type: `${label} 확인`,
          message: `${label}이 수량 × 단가와 다릅니다. 예상 금액은 ${Math.round(expected).toLocaleString("ko-KR")}원입니다.`
        }));
      }
    });
  });

  duplicateMap.forEach((rows, key) => {
    if (rows.length <= 1 || key.replace(/\|/g, "") === "") return;
    const [itemName] = key.split("|");
    rows.forEach((rn) => {
      issues.push(issue({
        uploadId,
        rowNo: rn,
        itemName,
        level: "warning",
        type: "중복 품목 확인",
        message: `동일 품목·규격·장소가 중복되어 있습니다. 대상 행: ${rows.join(", ")}`
      }));
    });
  });

  return issues;
}
