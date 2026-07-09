import * as XLSX from "xlsx";
import type { ConsumableItem, Department, ParsedUploadResult, UploadRecord } from "./types";
import { validateItems } from "./validation";

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/\(원\)/g, "")
    .replace(/_/g, "")
    .trim();
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .trim();
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/,/g, "").replace(/원/g, "").trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function pickSheetName(workbook: XLSX.WorkBook, department: Department) {
  const names = workbook.SheetNames;
  const candidates = department === "cleaning"
    ? ["미화", "의약품", "clean"]
    : ["푸드", "조리", "food"];

  return names.find((name) => candidates.some((word) => name.toLowerCase().includes(word.toLowerCase()))) ?? names[0];
}

function findHeaderRow(rows: unknown[][]) {
  return rows.findIndex((row) => {
    const normalized = row.map(normalizeHeader);
    return normalized.some((v) => v.includes("품목명")) && normalized.some((v) => v.includes("단가"));
  });
}

function findColumn(headers: unknown[], patterns: RegExp[]) {
  const normalized = headers.map(normalizeHeader);
  return normalized.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
}

function getCell(row: unknown[], index: number) {
  return index >= 0 ? row[index] : null;
}

export async function parseConsumableExcel(params: {
  file: File;
  year: number;
  month: number;
  department: Department;
}): Promise<ParsedUploadResult> {
  const { file, year, month, department } = params;
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const sheetName = pickSheetName(workbook, department);
  const worksheet = workbook.Sheets[sheetName];

  if (!worksheet) {
    throw new Error("엑셀 파일에서 읽을 수 있는 시트를 찾지 못했습니다.");
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: null,
    raw: true
  });

  const headerRowIndex = findHeaderRow(rows);
  if (headerRowIndex < 0) {
    throw new Error("품목명/단가가 포함된 헤더 행을 찾지 못했습니다. 수불관리대장 양식인지 확인해주세요.");
  }

  const headers = rows[headerRowIndex];
  const col = {
    no: findColumn(headers, [/^NO$/i, /^No$/i, /^번호$/]),
    majorCategory: findColumn(headers, [/대분류/]),
    middleCategory: findColumn(headers, [/중분류/]),
    subCategory: findColumn(headers, [/소분류/]),
    itemName: findColumn(headers, [/품목명/]),
    specification: findColumn(headers, [/규격/]),
    unit: findColumn(headers, [/단위/]),
    location: findColumn(headers, [/장소/]),
    prevQty: findColumn(headers, [/전월.*이월량/]),
    inQty: findColumn(headers, [/당월.*입고량/]),
    usedQty: findColumn(headers, [/당월.*사용량/]),
    currentQty: findColumn(headers, [/^현재고$/, /현.*재고$/]),
    unitPrice: findColumn(headers, [/단가/]),
    prevAmount: findColumn(headers, [/전월.*이월.*계/]),
    inAmount: findColumn(headers, [/당월.*입고.*계/]),
    usedAmount: findColumn(headers, [/당월.*사용.*계/]),
    currentAmount: findColumn(headers, [/현.*재고.*비용.*계/, /현재고.*비용.*계/]),
    note: findColumn(headers, [/비고/])
  };

  const required = ["itemName", "prevQty", "inQty", "usedQty", "currentQty", "unitPrice"] as const;
  const missing = required.filter((key) => col[key] < 0);
  if (missing.length > 0) {
    throw new Error(`필수 열을 찾지 못했습니다: ${missing.join(", ")}`);
  }

  const uploadId = crypto.randomUUID();
  const now = new Date().toISOString();

  const upload: UploadRecord = {
    id: uploadId,
    year,
    month,
    department,
    originalFileName: file.name,
    status: "draft",
    uploadedAt: now,
    updatedAt: now
  };

  const items: ConsumableItem[] = rows
    .slice(headerRowIndex + 1)
    .map((row, offset) => {
      const itemName = normalizeText(getCell(row, col.itemName));
      if (!itemName || itemName.includes("합계")) return null;
      const noRaw = getCell(row, col.no);
      const no = col.no >= 0 && noRaw !== null && noRaw !== "" ? toNumber(noRaw) : offset + 1;
      return {
        id: crypto.randomUUID(),
        uploadId,
        year,
        month,
        department,
        no: Number.isFinite(no) ? no : offset + 1,
        majorCategory: normalizeText(getCell(row, col.majorCategory)),
        middleCategory: normalizeText(getCell(row, col.middleCategory)),
        subCategory: normalizeText(getCell(row, col.subCategory)),
        itemName,
        specification: normalizeText(getCell(row, col.specification)),
        unit: normalizeText(getCell(row, col.unit)),
        location: normalizeText(getCell(row, col.location)),
        prevQty: toNumber(getCell(row, col.prevQty)),
        inQty: toNumber(getCell(row, col.inQty)),
        usedQty: toNumber(getCell(row, col.usedQty)),
        currentQty: toNumber(getCell(row, col.currentQty)),
        unitPrice: toNumber(getCell(row, col.unitPrice)),
        prevAmount: col.prevAmount >= 0 ? toNumber(getCell(row, col.prevAmount)) : 0,
        inAmount: col.inAmount >= 0 ? toNumber(getCell(row, col.inAmount)) : 0,
        usedAmount: col.usedAmount >= 0 ? toNumber(getCell(row, col.usedAmount)) : 0,
        currentAmount: col.currentAmount >= 0 ? toNumber(getCell(row, col.currentAmount)) : 0,
        note: normalizeText(getCell(row, col.note))
      } satisfies ConsumableItem;
    })
    .filter(Boolean) as ConsumableItem[];

  const issues = validateItems(uploadId, items);
  upload.status = issues.some((issue) => issue.level === "error") ? "draft" : "validated";

  return { upload, items, issues };
}

export function exportItemsToWorkbook(items: ConsumableItem[]) {
  const rows = items.map((item) => ({
    NO: item.no ?? "",
    구분: item.department === "cleaning" ? "미화·의약품" : "푸드",
    연도: item.year,
    월: item.month,
    대분류: item.majorCategory,
    중분류: item.middleCategory,
    소분류: item.subCategory,
    품목명: item.itemName,
    규격: item.specification,
    단위: item.unit,
    장소: item.location,
    전월이월량: item.prevQty,
    당월입고량: item.inQty,
    당월사용량: item.usedQty,
    현재고: item.currentQty,
    단가: item.unitPrice,
    전월이월금액: item.prevAmount,
    당월입고금액: item.inAmount,
    당월사용금액: item.usedAmount,
    현재고금액: item.currentAmount,
    비고: item.note
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "소모품현황");
  XLSX.writeFile(wb, "소모품_운영현황_수정본.xlsx");
}
