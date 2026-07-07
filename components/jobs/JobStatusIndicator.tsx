"use client";

import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/auth/fetchWithAuth";
import { Loader2, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { JobType, JobStatus } from "@prisma/client";

interface JobStatusIndicatorProps {
  jobId: string;
  onComplete?: () => void;
  onClose?: () => void;
}

interface JobData {
  id: string;
  jobType: JobType;
  status: JobStatus;
  attempts: number;
  errorMessage: string | null;
}

export function JobStatusIndicator({ jobId, onComplete, onClose }: JobStatusIndicatorProps) {
  const [job, setJob] = useState<JobData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    const fetchStatus = async () => {
      try {
        const res = await fetchWithAuth(`/api/jobs/${jobId}`);
        if (!res.ok) {
          throw new Error("Failed to fetch job status");
        }
        const data = await res.json();
        setJob(data);

        if (data.status === "COMPLETED" || data.status === "FAILED" || data.status === "CANCELLED") {
          clearInterval(intervalId);
          if (data.status === "COMPLETED" && onComplete) {
            onComplete();
          }
        }
      } catch (err: any) {
        setError(err.message);
        clearInterval(intervalId);
      }
    };

    // Fetch immediately, then poll every 2s
    fetchStatus();
    intervalId = setInterval(fetchStatus, 2000);

    return () => clearInterval(intervalId);
  }, [jobId, onComplete]);

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">
        <AlertCircle className="h-4 w-4" />
        <span>Error checking status: {error}</span>
        {onClose && (
          <button onClick={onClose} className="ml-auto text-xs font-semibold hover:underline">
            Dismiss
          </button>
        )}
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 bg-gray-50 px-3 py-2 rounded-md">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Initializing job...</span>
      </div>
    );
  }

  const getStatusDisplay = () => {
    switch (job.status) {
      case "PENDING":
        return {
          icon: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />,
          text: job.attempts > 0 
            ? `Retrying (Attempt ${job.attempts + 1})...` 
            : "Queued for execution...",
          colorClass: "bg-blue-50 text-blue-700 border-blue-100",
        };
      case "RUNNING":
        return {
          icon: <Loader2 className="h-4 w-4 animate-spin text-blue-600" />,
          text: "Executing job...",
          colorClass: "bg-blue-50 text-blue-700 border-blue-200",
        };
      case "COMPLETED":
        return {
          icon: <CheckCircle2 className="h-4 w-4 text-green-600" />,
          text: "Completed successfully.",
          colorClass: "bg-green-50 text-green-700 border-green-200",
        };
      case "FAILED":
        return {
          icon: <XCircle className="h-4 w-4 text-red-600" />,
          text: `Failed: ${job.errorMessage ?? "Unknown error"}`,
          colorClass: "bg-red-50 text-red-700 border-red-200",
        };
      case "CANCELLED":
        return {
          icon: <XCircle className="h-4 w-4 text-gray-500" />,
          text: "Job was cancelled.",
          colorClass: "bg-gray-50 text-gray-700 border-gray-200",
        };
      default:
        return {
          icon: <AlertCircle className="h-4 w-4 text-gray-500" />,
          text: `Unknown status: ${job.status}`,
          colorClass: "bg-gray-50 text-gray-700",
        };
    }
  };

  const display = getStatusDisplay();

  return (
    <div className={`flex items-center justify-between gap-3 text-sm px-3 py-2 rounded-md border ${display.colorClass}`}>
      <div className="flex items-center gap-2">
        {display.icon}
        <span className="font-medium">{display.text}</span>
      </div>
      {(job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELLED") && onClose && (
        <button onClick={onClose} className="text-xs font-semibold hover:underline opacity-80 hover:opacity-100">
          Dismiss
        </button>
      )}
    </div>
  );
}
