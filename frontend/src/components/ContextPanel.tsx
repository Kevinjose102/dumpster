import React, { useState, useEffect } from "react";
import { Archive, Trash } from "@phosphor-icons/react";
import { api } from "../api";
import type { MediaFile } from "../api";

const MediaPreview: React.FC<{ file: MediaFile }> = ({ file }) => {
  const [highResLoaded, setHighResLoaded] = useState(false);
  const [highResError, setHighResError] = useState(false);

  // Reset state when previewed file changes
  useEffect(() => {
    setHighResLoaded(false);
    setHighResError(false);
  }, [file.id]);

  const thumbUrl = api.getThumbnailUrl(file.id, file.original_path, file.extension);
  const fileUrl = api.getFileUrl(file.id, file.original_path);

  return (
    <div className="w-full flex flex-col gap-2">
      <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.15em] mb-1">
        Media Preview
      </h3>
      <div className="w-full aspect-[4/3] rounded bg-black/40 border border-border-subtle relative overflow-hidden flex items-center justify-center">
        {/* Instant low-res blur-up thumbnail placeholder */}
        <img
          src={thumbUrl}
          alt=""
          className={`absolute inset-0 w-full h-full object-cover blur-sm opacity-50 transition-opacity duration-300 ${
            highResLoaded ? "opacity-20" : "opacity-50"
          }`}
        />

        {file.file_type === "video" ? (
          <video
            src={fileUrl}
            controls
            className="w-full h-full object-contain relative z-10"
            poster={thumbUrl}
          />
        ) : (
          <>
            {/* High-res image loaded dynamically */}
            <img
              src={fileUrl}
              alt={file.name}
              onLoad={() => setHighResLoaded(true)}
              onError={() => setHighResError(true)}
              className={`w-full h-full object-contain relative z-10 transition-opacity duration-300 ${
                highResLoaded ? "opacity-100" : "opacity-0"
              }`}
            />

            {/* Spinner while loading original high-res file */}
            {!highResLoaded && !highResError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/10 z-20">
                <div className="w-6 h-6 border-2 border-accent-teal border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {/* Error state */}
            {highResError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-text-muted z-20">
                <span className="text-[10px] font-mono uppercase">Failed to load preview</span>
              </div>
            )}
          </>
        )}
      </div>
      <div className="flex flex-col gap-0.5 mt-1 font-mono text-[9px] text-text-muted uppercase">
        <span className="text-text-secondary truncate font-semibold font-sans normal-case text-xs text-text-primary">
          {file.name}
        </span>
        <span className="truncate" title={file.original_path}>
          {file.original_path}
        </span>
        <span>{new Date(file.date).toLocaleString()}</span>
      </div>
    </div>
  );
};

interface ContextPanelProps {
  selectedCount: number;
  selectedSize: number;
  selectedFile: MediaFile | null;
  onArchive: () => void;
  onDelete: () => void;
  loading: boolean;
}

export const ContextPanel: React.FC<ContextPanelProps> = ({
  selectedCount,
  selectedSize,
  selectedFile,
  onArchive,
  onDelete,
  loading,
}) => {
  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <div className="w-80 bg-panel-bg border-l border-border-subtle flex flex-col justify-between py-6 px-6 transition-all duration-300 select-none animate-slide-in">
      <div className="flex flex-col gap-6">
        {/* Selection summary */}
        <div>
          <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.15em] mb-4">
            Selection details
          </h3>
          <div className="bg-black/20 rounded p-4 border border-border-subtle">
            <div className="flex justify-between items-baseline mb-2">
              <span className="text-xs text-text-secondary">Selected:</span>
              <span className="font-mono text-xl font-bold text-accent-teal">
                {selectedCount}
              </span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-xs text-text-secondary">Total Size:</span>
              <span className="font-mono text-sm font-semibold text-text-primary">
                {formatSize(selectedSize)}
              </span>
            </div>
          </div>
        </div>

        {/* Media Preview (renders blank placeholder if no files are selected) */}
        {selectedCount === 1 && selectedFile ? (
          <MediaPreview file={selectedFile} />
        ) : (
          <div className="w-full flex flex-col gap-2">
            <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.15em] mb-1">
              Media Preview
            </h3>
            <div className="w-full aspect-[4/3] rounded bg-black/10 border border-dashed border-border-subtle flex flex-col items-center justify-center p-4 text-center text-text-muted">
              <span className="text-[10px] font-mono uppercase tracking-wider">No Selection</span>
              <span className="text-[9px] mt-1 normal-case font-sans">
                {selectedCount > 1 ? `${selectedCount} files selected` : "Select a file to inspect and preview"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3">
        {/* Archive Button */}
        <button
          onClick={onArchive}
          disabled={loading || selectedCount === 0}
          className="w-full flex items-center justify-center gap-2.5 bg-accent-green hover:bg-accent-green-hover text-white text-xs font-semibold py-3 px-4 rounded transition-colors disabled:opacity-50 uppercase tracking-wider"
        >
          <Archive size={16} weight="bold" />
          {loading ? "Processing..." : "Archive Selected"}
        </button>

        {/* Delete Button */}
        <button
          onClick={onDelete}
          disabled={loading || selectedCount === 0}
          className="w-full flex items-center justify-center gap-2.5 bg-accent-red hover:bg-accent-red-hover text-white text-xs font-semibold py-3 px-4 rounded transition-colors disabled:opacity-50 uppercase tracking-wider"
        >
          <Trash size={16} weight="bold" />
          {loading ? "Processing..." : "Delete Selected"}
        </button>

        <p className="text-[9px] text-text-muted text-center mt-2 leading-relaxed uppercase tracking-wider select-none font-mono">
          Deleted items go to PC Recovery Bin
        </p>
      </div>
    </div>
  );
};
