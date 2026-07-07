"use client";
import { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "./dialog";
import { Button } from "./button";
import { Input } from "./input";

interface AzureDeleteDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  /** The exact name the user must type to confirm */
  resourceName: string;
  /** "resource" or "resource group" */
  resourceType: "resource" | "resource group";
  /** Extra detail shown in the warning e.g. type or resource count */
  detail?: string;
}

export function AzureDeleteDialog({
  open,
  onClose,
  onConfirm,
  resourceName,
  resourceType,
  detail,
}: AzureDeleteDialogProps) {
  const [typedName, setTypedName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const isRG = resourceType === "resource group";
  const matches = typedName.trim() === resourceName;

  async function handleConfirm() {
    if (!matches) return;
    setDeleting(true);
    setError("");
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  function handleClose() {
    if (deleting) return;
    setTypedName("");
    setError("");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
              <Trash2 className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <DialogTitle className="text-red-700">
                Delete {resourceType} from Azure
              </DialogTitle>
            </div>
          </div>
          <DialogDescription asChild>
            <div className="space-y-3">
              {/* Warning banner */}
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
                <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                <div className="text-sm text-red-800">
                  <p className="font-semibold">This is irreversible.</p>
                  {isRG ? (
                    <p className="mt-1">
                      Deleting a resource group will permanently destroy <strong>all resources inside it</strong> in Azure. This cannot be undone.
                    </p>
                  ) : (
                    <p className="mt-1">
                      This will permanently delete the resource from Azure. All associated data will be lost.
                    </p>
                  )}
                </div>
              </div>

              {/* Requires Contributor note */}
              <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800">
                <strong>Role requirement:</strong> Your service principal must have <strong>Contributor</strong> on this subscription. Cost Management Reader is not sufficient for deletion.
              </div>

              {detail && (
                <p className="text-xs text-gray-500">{detail}</p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 my-2">
          <p className="text-sm text-gray-700">
            Type <strong className="font-mono bg-gray-100 px-1 rounded">{resourceName}</strong> to confirm:
          </p>
          <Input
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder={resourceName}
            className={matches ? "border-red-400 focus:ring-red-500" : ""}
            autoComplete="off"
            onKeyDown={(e) => e.key === "Enter" && matches && handleConfirm()}
          />
          {error && (
            <div className="text-sm text-red-600 bg-red-50 rounded p-2 space-y-1">
              {error.split(". ").map((line, i) => (
                <p key={i}>{line}{i < error.split(". ").length - 1 ? "." : ""}</p>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!matches || deleting}
            loading={deleting}
            className="bg-red-600 hover:bg-red-700"
          >
            <Trash2 className="h-4 w-4" />
            {isRG ? "Delete resource group" : "Delete resource"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
