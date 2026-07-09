export type Department = "cleaning" | "food";
export type UploadStatus = "draft" | "validated" | "confirmed";

export type Role = "admin" | "cleaning_manager" | "food_manager" | "viewer";

export interface UploadRecord {
  id: string;
  year: number;
  month: number;
  department: Department;
  originalFileName: string;
  status: UploadStatus;
  uploadedAt: string;
  updatedAt: string;
}

export interface ConsumableItem {
  id: string;
  uploadId: string;
  year: number;
  month: number;
  department: Department;
  no: number | null;
  majorCategory: string;
  middleCategory: string;
  subCategory: string;
  itemName: string;
  specification: string;
  unit: string;
  location: string;
  prevQty: number;
  inQty: number;
  usedQty: number;
  currentQty: number;
  unitPrice: number;
  prevAmount: number;
  inAmount: number;
  usedAmount: number;
  currentAmount: number;
  note: string;
}

export interface ValidationIssue {
  id: string;
  uploadId: string;
  rowNo: number;
  itemName: string;
  level: "error" | "warning";
  type: string;
  message: string;
}

export interface AuditLog {
  id: string;
  itemId: string;
  fieldName: keyof ConsumableItem;
  oldValue: string;
  newValue: string;
  editedAt: string;
}

export interface ParsedUploadResult {
  upload: UploadRecord;
  items: ConsumableItem[];
  issues: ValidationIssue[];
}

export interface MonthlySummary {
  year: number;
  month: number;
  cleaningUsed: number;
  foodUsed: number;
  totalUsed: number;
  cleaningStock: number;
  foodStock: number;
  totalStock: number;
  totalInAmount: number;
}
