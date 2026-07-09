import { isSupabaseConfigured, supabase } from "./supabase";
import type { AuditLog, ConsumableItem, ParsedUploadResult, UploadRecord, ValidationIssue } from "./types";

const LOCAL_ITEMS_KEY = "consumables-dashboard-items";
const LOCAL_UPLOADS_KEY = "consumables-dashboard-uploads";
const LOCAL_ISSUES_KEY = "consumables-dashboard-issues";
const LOCAL_AUDIT_KEY = "consumables-dashboard-audit";

function getLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function setLocal<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

function itemToDb(item: ConsumableItem) {
  return {
    id: item.id,
    upload_id: item.uploadId,
    year: item.year,
    month: item.month,
    department: item.department,
    no: item.no,
    major_category: item.majorCategory,
    middle_category: item.middleCategory,
    sub_category: item.subCategory,
    item_name: item.itemName,
    specification: item.specification,
    unit: item.unit,
    location: item.location,
    prev_qty: item.prevQty,
    in_qty: item.inQty,
    used_qty: item.usedQty,
    current_qty: item.currentQty,
    unit_price: item.unitPrice,
    prev_amount: item.prevAmount,
    in_amount: item.inAmount,
    used_amount: item.usedAmount,
    current_amount: item.currentAmount,
    note: item.note
  };
}

function itemFromDb(row: any): ConsumableItem {
  return {
    id: row.id,
    uploadId: row.upload_id,
    year: row.year,
    month: row.month,
    department: row.department,
    no: row.no,
    majorCategory: row.major_category ?? "",
    middleCategory: row.middle_category ?? "",
    subCategory: row.sub_category ?? "",
    itemName: row.item_name ?? "",
    specification: row.specification ?? "",
    unit: row.unit ?? "",
    location: row.location ?? "",
    prevQty: Number(row.prev_qty ?? 0),
    inQty: Number(row.in_qty ?? 0),
    usedQty: Number(row.used_qty ?? 0),
    currentQty: Number(row.current_qty ?? 0),
    unitPrice: Number(row.unit_price ?? 0),
    prevAmount: Number(row.prev_amount ?? 0),
    inAmount: Number(row.in_amount ?? 0),
    usedAmount: Number(row.used_amount ?? 0),
    currentAmount: Number(row.current_amount ?? 0),
    note: row.note ?? ""
  };
}

function uploadToDb(upload: UploadRecord, storagePath?: string) {
  const row: Record<string, unknown> = {
    id: upload.id,
    year: upload.year,
    month: upload.month,
    department: upload.department,
    original_file_name: upload.originalFileName,
    status: upload.status,
    uploaded_at: upload.uploadedAt,
    updated_at: upload.updatedAt
  };
  if (storagePath !== undefined) row.storage_path = storagePath;
  return row;
}

function uploadFromDb(row: any): UploadRecord {
  return {
    id: row.id,
    year: row.year,
    month: row.month,
    department: row.department,
    originalFileName: row.original_file_name,
    status: row.status,
    uploadedAt: row.uploaded_at,
    updatedAt: row.updated_at
  };
}

function issueToDb(issue: ValidationIssue) {
  return {
    id: issue.id,
    upload_id: issue.uploadId,
    row_no: issue.rowNo,
    item_name: issue.itemName,
    error_level: issue.level,
    error_type: issue.type,
    message: issue.message
  };
}

function issueFromDb(row: any): ValidationIssue {
  return {
    id: row.id,
    uploadId: row.upload_id,
    rowNo: row.row_no,
    itemName: row.item_name ?? "",
    level: row.error_level,
    type: row.error_type,
    message: row.message
  };
}

function auditToDb(log: AuditLog) {
  return {
    id: log.id,
    item_id: log.itemId,
    field_name: String(log.fieldName),
    old_value: log.oldValue,
    new_value: log.newValue,
    edited_at: log.editedAt
  };
}

function auditFromDb(row: any): AuditLog {
  return {
    id: row.id,
    itemId: row.item_id,
    fieldName: row.field_name,
    oldValue: row.old_value ?? "",
    newValue: row.new_value ?? "",
    editedAt: row.edited_at
  };
}

export async function loadAllData() {
  if (isSupabaseConfigured && supabase) {
    const [{ data: uploads }, { data: items }, { data: issues }, { data: auditLogs }] = await Promise.all([
      supabase.from("consumable_uploads").select("*"),
      supabase.from("consumable_items").select("*"),
      supabase.from("consumable_validation_errors").select("*"),
      supabase.from("consumable_audit_logs").select("*").order("edited_at", { ascending: false }).limit(200)
    ]);

    return {
      uploads: (uploads ?? []).map(uploadFromDb),
      items: (items ?? []).map(itemFromDb),
      issues: (issues ?? []).map(issueFromDb),
      auditLogs: (auditLogs ?? []).map(auditFromDb)
    };
  }

  return {
    uploads: getLocal<UploadRecord[]>(LOCAL_UPLOADS_KEY, []),
    items: getLocal<ConsumableItem[]>(LOCAL_ITEMS_KEY, []),
    issues: getLocal<ValidationIssue[]>(LOCAL_ISSUES_KEY, []),
    auditLogs: getLocal<AuditLog[]>(LOCAL_AUDIT_KEY, [])
  };
}

export async function saveUploadResult(result: ParsedUploadResult, file?: File) {
  if (isSupabaseConfigured && supabase) {
    let storagePath: string | undefined;
    if (file) {
      storagePath = `consumables/${result.upload.year}/${String(result.upload.month).padStart(2, "0")}/${result.upload.department}/${Date.now()}_${file.name}`;
      await supabase.storage.from("consumable-files").upload(storagePath, file, { upsert: true });
    }

    const { data: existing } = await supabase
      .from("consumable_uploads")
      .select("id")
      .eq("year", result.upload.year)
      .eq("month", result.upload.month)
      .eq("department", result.upload.department)
      .maybeSingle();

    const uploadId = existing?.id ?? result.upload.id;
    const upload = { ...result.upload, id: uploadId };
    const items = result.items.map((item) => ({ ...item, uploadId }));
    const issues = result.issues.map((issue) => ({ ...issue, uploadId }));

    await supabase.from("consumable_uploads").upsert(uploadToDb(upload, storagePath), {
      onConflict: "year,month,department"
    });

    await supabase.from("consumable_items").delete().eq("upload_id", uploadId);
    await supabase.from("consumable_validation_errors").delete().eq("upload_id", uploadId);

    if (items.length) await supabase.from("consumable_items").insert(items.map(itemToDb));
    if (issues.length) await supabase.from("consumable_validation_errors").insert(issues.map(issueToDb));
    return;
  }

  const uploads = getLocal<UploadRecord[]>(LOCAL_UPLOADS_KEY, []);
  const items = getLocal<ConsumableItem[]>(LOCAL_ITEMS_KEY, []);
  const issues = getLocal<ValidationIssue[]>(LOCAL_ISSUES_KEY, []);

  const filteredUploads = uploads.filter((u) => !(u.year === result.upload.year && u.month === result.upload.month && u.department === result.upload.department));
  const removedUploadIds = uploads
    .filter((u) => u.year === result.upload.year && u.month === result.upload.month && u.department === result.upload.department)
    .map((u) => u.id);

  setLocal(LOCAL_UPLOADS_KEY, [...filteredUploads, result.upload]);
  setLocal(LOCAL_ITEMS_KEY, [
    ...items.filter((item) => !removedUploadIds.includes(item.uploadId)),
    ...result.items
  ]);
  setLocal(LOCAL_ISSUES_KEY, [
    ...issues.filter((issue) => !removedUploadIds.includes(issue.uploadId)),
    ...result.issues
  ]);
}

export async function saveItems(items: ConsumableItem[]) {
  if (isSupabaseConfigured && supabase) {
    await supabase.from("consumable_items").upsert(items.map(itemToDb));
    return;
  }
  setLocal(LOCAL_ITEMS_KEY, items);
}

export async function saveIssues(issues: ValidationIssue[]) {
  if (isSupabaseConfigured && supabase) {
    await supabase
      .from("consumable_validation_errors")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (issues.length) await supabase.from("consumable_validation_errors").insert(issues.map(issueToDb));
    return;
  }
  setLocal(LOCAL_ISSUES_KEY, issues);
}

export async function saveUploads(uploads: UploadRecord[]) {
  if (isSupabaseConfigured && supabase) {
    await supabase.from("consumable_uploads").upsert(uploads.map((u) => uploadToDb(u)));
    return;
  }
  setLocal(LOCAL_UPLOADS_KEY, uploads);
}

export async function saveAuditLog(log: AuditLog) {
  if (isSupabaseConfigured && supabase) {
    await supabase.from("consumable_audit_logs").insert(auditToDb(log));
    return;
  }
  const logs = getLocal<AuditLog[]>(LOCAL_AUDIT_KEY, []);
  setLocal(LOCAL_AUDIT_KEY, [log, ...logs].slice(0, 200));
}
