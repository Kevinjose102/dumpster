import React, { useState, useEffect } from "react";
import { api } from "../api";
import type { RecoveryFile } from "../api";
import { X, ArrowCounterClockwise, Trash, Warning } from "@phosphor-icons/react";


interface RecoveryBinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefreshStats: () => void;
}

export const RecoveryBinModal: React.FC<RecoveryBinModalProps> = ({
  isOpen,
  onClose,
  onRefreshStats,
}) => {
  const [files, setFiles] = useState<RecoveryFile[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [showConfirmPurge, setShowConfirmPurge] = useState(false);
  const [purgeMode, setPurgeMode] = useState<"selected" | "all">("selected");

  const fetchFiles = async () => {
    try {
      setLoading(true);
      const data = await api.getRecoveryBin();
      setFiles(data);
      setSelectedIds(new Set());
    } catch (e) {
      console.error("Error loading recovery bin:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchFiles();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleToggleAll = () => {
    if (selectedIds.size === files.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(files.map((f) => f.id)));
    }
  };

  const handleRestore = async () => {
    if (selectedIds.size === 0) return;
    try {
      setLoading(true);
      const ids = Array.from(selectedIds);
      const res = await api.restoreRecoveryFiles(ids);
      alert(`Successfully restored ${res.success_count} files back to the phone!`);
      fetchFiles();
      onRefreshStats();
    } catch (e) {
      alert("Failed to restore files: " + e);
    } finally {
      setLoading(false);
    }
  };

  const triggerPurge = (mode: "selected" | "all") => {
    if (mode === "selected" && selectedIds.size === 0) return;
    setPurgeMode(mode);
    setShowConfirmPurge(true);
  };

  const handleConfirmPurge = async () => {
    setShowConfirmPurge(false);
    try {
      setLoading(true);
      if (purgeMode === "all") {
        await api.purgeAllRecoveryFiles();
      } else {
        await api.purgeRecoveryFiles(Array.from(selectedIds));
      }
      fetchFiles();
      onRefreshStats();
    } catch (e) {
      alert("Failed to permanently delete files: " + e);
    } finally {
      setLoading(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6 animate-fade-in select-none">
      <div className="bg-panel-bg w-full max-w-4xl h-[80vh] rounded border border-border-subtle flex flex-col justify-between overflow-hidden shadow-2xl relative">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center bg-black/10">
          <div>
            <h2 className="text-sm font-semibold tracking-wider text-text-primary uppercase">
              Recovery Bin (PC Local Backup)
            </h2>
            <p className="text-[10px] text-text-muted mt-0.5 uppercase tracking-wide font-mono">
              Safely recover deleted files or purge them to free PC disk space
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary p-1 rounded hover:bg-white/[0.05] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Action Toolbar */}
        {files.length > 0 && (
          <div className="px-6 py-3 bg-[#151518] border-b border-border-subtle flex justify-between items-center">
            <div className="flex items-center gap-4">
              <button
                onClick={handleToggleAll}
                className="text-[10px] uppercase font-mono px-2 py-1 rounded border border-border-subtle text-text-secondary hover:text-text-primary hover:border-text-secondary"
              >
                {selectedIds.size === files.length ? "Deselect All" : "Select All"}
              </button>
              <span className="text-[10px] font-mono text-text-muted uppercase">
                {selectedIds.size} of {files.length} selected
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Restore Button */}
              <button
                onClick={handleRestore}
                disabled={selectedIds.size === 0 || loading}
                className="flex items-center gap-1.5 bg-accent-green hover:bg-accent-green-hover text-white text-[10px] font-semibold uppercase tracking-wider py-1.5 px-3 rounded transition-colors disabled:opacity-50"
              >
                <ArrowCounterClockwise size={12} weight="bold" />
                Restore Selected
              </button>

              {/* Purge Selected */}
              <button
                onClick={() => triggerPurge("selected")}
                disabled={selectedIds.size === 0 || loading}
                className="flex items-center gap-1.5 bg-accent-red hover:bg-accent-red-hover text-white text-[10px] font-semibold uppercase tracking-wider py-1.5 px-3 rounded transition-colors disabled:opacity-50"
              >
                <Trash size={12} weight="bold" />
                Purge Selected
              </button>

              {/* Purge All */}
              <button
                onClick={() => triggerPurge("all")}
                disabled={files.length === 0 || loading}
                className="flex items-center gap-1.5 border border-accent-red text-accent-red hover:bg-accent-red/10 text-[10px] font-semibold uppercase tracking-wider py-1.5 px-3 rounded transition-colors"
              >
                <Trash size={12} weight="bold" />
                Empty Bin
              </button>
            </div>
          </div>
        )}

        {/* Content Table / List */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && files.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center text-text-muted font-mono text-xs">
              Loading recovery bin database...
            </div>
          ) : files.length === 0 ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-text-muted">
              <p className="text-sm">Recovery Bin is currently empty</p>
              <p className="text-xs mt-1">Files deleted from phone will be backed up here</p>
            </div>
          ) : (
            <div className="border border-border-subtle rounded overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-black/40 border-b border-border-subtle text-[10px] font-mono text-text-muted uppercase">
                    <th className="py-3 px-4 w-10"></th>
                    <th className="py-3 px-4">File Name</th>
                    <th className="py-3 px-4">Original Location</th>
                    <th className="py-3 px-4 w-28">Category</th>
                    <th className="py-3 px-4 w-24">Size</th>
                    <th className="py-3 px-4 w-44">Deleted At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle bg-black/10">
                  {files.map((file) => {
                    const isSel = selectedIds.has(file.id);
                    return (
                      <tr
                        key={file.id}
                        onClick={() => handleToggleSelect(file.id)}
                        className={`hover:bg-white/[0.02] cursor-pointer transition-colors ${
                          isSel ? "bg-accent-teal/5" : ""
                        }`}
                      >
                        <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => handleToggleSelect(file.id)}
                            className="rounded border-border-subtle accent-accent-teal w-3.5 h-3.5"
                          />
                        </td>
                        <td className="py-3 px-4 font-medium text-text-primary truncate max-w-[200px]" title={file.name}>
                          {file.name}
                        </td>
                        <td className="py-3 px-4 text-text-secondary font-mono text-[10px] truncate max-w-[280px]" title={file.original_path}>
                          {file.original_path}
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-[9px] font-mono uppercase bg-[#1f2025] px-2 py-0.5 rounded border border-border-subtle text-text-secondary">
                            {file.category}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-text-secondary">
                          {formatSize(file.size)}
                        </td>
                        <td className="py-3 px-4 text-text-secondary font-mono text-[10px]">
                          {formatDate(file.deleted_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Confirmation Modal Overlay */}
        {showConfirmPurge && (
          <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50 p-6 animate-fade-in">
            <div className="bg-panel-bg max-w-md p-6 rounded border border-accent-red shadow-2xl flex flex-col gap-4 text-center">
              <div className="flex justify-center text-accent-red">
                <Warning size={48} weight="fill" />
              </div>
              <h3 className="text-sm font-semibold uppercase text-text-primary tracking-wider">
                Confirm Permanent Deletion
              </h3>
              <p className="text-xs text-text-secondary leading-relaxed">
                {purgeMode === "all"
                  ? "Are you sure you want to EMPTY the entire Recovery Bin? This operation is destructive and cannot be undone."
                  : `Are you sure you want to permanently delete the ${selectedIds.size} selected files from your PC? This operation cannot be undone.`}
              </p>
              <div className="flex justify-center gap-3 mt-2">
                <button
                  onClick={() => setShowConfirmPurge(false)}
                  className="bg-zinc-800 hover:bg-zinc-700 text-text-primary text-xs font-semibold px-4 py-2.5 rounded transition-colors uppercase tracking-wider font-mono"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmPurge}
                  className="bg-accent-red hover:bg-accent-red-hover text-white text-xs font-semibold px-4 py-2.5 rounded transition-colors uppercase tracking-wider font-mono"
                >
                  Permanently Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
