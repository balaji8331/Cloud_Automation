/**
 * Audit log helpers — write access events to the audit_log table.
 */
import prisma from "./index";

export type AuditAction =
  | "VIEW_DASHBOARD"
  | "VIEW_TENANTS"
  | "CREATE_TENANT"
  | "UPDATE_TENANT"
  | "DELETE_TENANT"
  | "TEST_CONNECTION"
  | "SYNC_TENANT"
  | "VIEW_BUDGETS"
  | "CREATE_BUDGET"
  | "UPDATE_BUDGET"
  | "DELETE_BUDGET"
  | "VIEW_REPORTS"
  | "EXPORT_CSV"
  | "EXPORT_PDF"
  | "VIEW_USERS"
  | "CREATE_USER"
  | "UPDATE_USER"
  | "DELETE_USER"
  | "LOGIN"
  | "LOGOUT"
  // Resource inventory actions
  | "REMOVE_RESOURCE"
  | "AZURE_DELETE_RESOURCE"
  | "AZURE_DELETE_RESOURCE_GROUP"
  | "BULK_REMOVE_RESOURCE"
  | "BULK_REMOVE_RESOURCE_GROUP"
  // Automation / deletion schedule actions
  | "CREATE_DELETION_SCHEDULE"
  | "UPDATE_DELETION_SCHEDULE"
  | "DELETE_DELETION_SCHEDULE"
  | "APPROVE_DELETION_SCHEDULE"
  | "RUN_DELETION_SCHEDULE"
  | "CANCEL_DELETION_RUN"
  // Super Admin actions
  | "PROMOTE_TO_SUPER_ADMIN"
  | "TERMINAL_SESSION_START"
  | "TERMINAL_SESSION_END"
  | "SCRIPT_SCHEDULE_CREATED"
  | "SCRIPT_SCHEDULE_UPDATED"
  | "SCRIPT_SCHEDULE_DELETED"
  | "SCRIPT_RUN_TRIGGERED"
  | "SCRIPT_RUN_COMPLETED"
  | "SCRIPT_RUN_FAILED"
  // VM Inventory actions
  | "CREATE_VM"
  | "BULK_CREATE_VM"
  | "AZURE_VM_PASSWORD_REVEAL"
  | "CREATE_VM_ASSIGNMENT";

export interface AuditParams {
  userId: string;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(params: AuditParams): Promise<void> {
  // Fire-and-forget — never block the main response
  setImmediate(async () => {
    try {
      await prisma.auditLog.create({
        data: {
          userId: params.userId,
          action: params.action,
          resourceType: params.resourceType,
          resourceId: params.resourceId,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          metadata: params.metadata ? (params.metadata as unknown as import("@prisma/client").Prisma.InputJsonValue) : {},
        },
      });
    } catch (err) {
      console.error("[AuditLog] Failed to write:", err);
    }
  });
}
