"use client";
import { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "./dialog";
import { Button } from "./button";
import { Input } from "./input";

interface BulkAzureDeleteDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (confirmPhrase: string) => Promise<void>;
  /** The number of items to delete */
  count: number;
  /** "resource" or "resource_group" */
  resourceType: "resource" | "resource_group";
}

export function BulkAzureDeleteDialog({
  open,
  onClose,
  onConfirm,
  count,
  resourceType,
}: BulkAzureDeleteDialogProps) {
  const [typedName, setTypedName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const isRG = resourceType === "resource_group";
  const requiredPhrase = "DELETE MULTIPLE";
  const matches = typedName.trim() === requiredPhrase;

  async function handleConfirm() {
    if (!matches) return;
    setDeleting(true);
    setError("");
    try {
      await onConfirm(typedName.trim());
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
                Bulk Delete {count} {isRG ? "Resource Group(s)" : "Resource(s)"} from Azure
              </DialogTitle>
            </div>
          </div>
          <DialogDescription asChild>
            <div className="space-y-3">
              {/* Warning banner */}
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
                <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                <div className="text-sm text-red-800">
                  <p className="font-semibold">This is highly destructive and irreversible.</p>
                  {isRG ? (
                    <p className="mt-1">
                      Deleting multiple resource groups will permanently destroy <strong>all resources inside them</strong> in Azure.
                    </p>
                  ) : (
                    <p className="mt-1">
                      This will permanently delete {count} resources from Azure. All associated data will be lost.
                    </p>
                  )}
                </div>
              </div>

              {/* Requires Contributor note */}
              <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800">
                <strong>Role requirement:</strong> Your service principal must have <strong>Contributor</strong> on the required subscriptions.
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 my-2">
          <p className="text-sm text-gray-700">
            Type <strong className="font-mono bg-gray-100 px-1 rounded">{requiredPhrase}</strong> to confirm:
          </p>
          <Input
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder={requiredPhrase}
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
            Delete from Azure
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
