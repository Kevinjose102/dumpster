import React, { useRef, useState, useEffect, useCallback } from "react";
import { api } from "../api";
import type { MediaFile } from "../api";
import { CheckCircle, Play, Image as ImageIcon } from "@phosphor-icons/react";

// --------------------------------------------------------------------------
// Thumbnail Queue — module-level singleton
// --------------------------------------------------------------------------
// Max concurrent thumbnail requests. MTP over USB is serial — keep this at 1
// to avoid "resource is in use" conflicts. Increase to 2 if the backend can
// handle it (i.e. if it is a mock/local device).
const MAX_CONCURRENT = 1;

interface QueueEntry {
  url: string;
  resolve: (blobUrl: string | null) => void;
}

const thumbnailCache = new Map<string, string>(); // fileId → blobUrl (or "error")
const queue: QueueEntry[] = [];
let running = 0;

function processQueue() {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const entry = queue.shift()!;
    running++;
    fetch(entry.url)
      .then((res) => {
        if (!res.ok) throw new Error("not ok");
        return res.blob();
      })
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        entry.resolve(blobUrl);
      })
      .catch(() => {
        entry.resolve(null);
      })
      .finally(() => {
        running--;
        processQueue();
      });
  }
}

/** Load a thumbnail — returns a blob URL or null on error. Caches results. */
function loadThumbnail(fileId: string, url: string): Promise<string | null> {
  if (thumbnailCache.has(fileId)) {
    return Promise.resolve(thumbnailCache.get(fileId) ?? null);
  }
  return new Promise((resolve) => {
    queue.push({
      url,
      resolve: (blobUrl) => {
        thumbnailCache.set(fileId, blobUrl ?? "error");
        resolve(blobUrl);
      },
    });
    processQueue();
  });
}

// --------------------------------------------------------------------------
// LazyThumbnail — individual tile that self-loads via IntersectionObserver
// --------------------------------------------------------------------------
interface LazyThumbnailProps {
  file: MediaFile;
  isSelected: boolean;
  onToggleSelect: (id: string, isShift: boolean) => void;
  onDoubleClick: (file: MediaFile) => void;
  width: number;
  height: number;
  left: number;
  top: number;
}

const LazyThumbnail: React.FC<LazyThumbnailProps> = ({
  file,
  isSelected,
  onToggleSelect,
  onDoubleClick,
  width,
  height,
  left,
  top,
}) => {
  const tileRef = useRef<HTMLDivElement>(null);
  const [thumbSrc, setThumbSrc] = useState<string | null>(() => {
    // Immediately resolve from cache if already loaded
    const cached = thumbnailCache.get(file.id);
    if (cached && cached !== "error") return cached;
    return null;
  });
  const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "error">(
    () => {
      const cached = thumbnailCache.get(file.id);
      if (!cached) return "idle";
      if (cached === "error") return "error";
      return "loaded";
    }
  );

  const startLoad = useCallback(() => {
    if (status !== "idle") return;
    setStatus("loading");
    const url = api.getThumbnailUrl(file.id, file.original_path, file.extension);
    loadThumbnail(file.id, url).then((blobUrl) => {
      if (blobUrl) {
        setThumbSrc(blobUrl);
        setStatus("loaded");
      } else {
        setStatus("error");
      }
    });
  }, [file, status]);

  useEffect(() => {
    // If already cached, skip observer
    if (status !== "idle") return;

    const el = tileRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          startLoad();
          observer.disconnect();
        }
      },
      { rootMargin: "200px" } // pre-load 200px before tile enters viewport
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [status, startLoad]);

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "—";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <div
      ref={tileRef}
      onClick={(e) => onToggleSelect(file.id, e.shiftKey)}
      onDoubleClick={() => onDoubleClick(file)}
      className={`absolute rounded transition-all duration-150 cursor-pointer flex flex-col bg-card-bg group select-none ${
        isSelected
          ? "ring-2 ring-accent-teal border-transparent shadow-[0_0_12px_rgba(0,184,169,0.3)]"
          : "border border-border-subtle hover:bg-card-hover hover:border-text-secondary"
      }`}
      style={{ width, height, left, top }}
    >
      {/* Thumbnail area */}
      <div className="flex-1 bg-black relative overflow-hidden rounded-t flex items-center justify-center">
        {status === "loaded" && thumbSrc ? (
          <img
            src={thumbSrc}
            alt={file.name}
            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
            draggable={false}
          />
        ) : status === "loading" ? (
          /* Shimmer placeholder */
          <div className="w-full h-full bg-gradient-to-r from-[#1a1b1e] via-[#24252a] to-[#1a1b1e] animate-pulse" />
        ) : status === "error" ? (
          /* Error state */
          <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-text-muted">
            <ImageIcon size={28} weight="thin" />
            <span className="text-[9px] font-mono uppercase tracking-wide">Error</span>
          </div>
        ) : (
          /* Idle — not yet visible, dark placeholder */
          <div className="w-full h-full bg-[#14151a]" />
        )}

        {/* Selection checkmark */}
        <div
          className={`absolute top-2 right-2 rounded-full p-0.5 transition-opacity duration-150 ${
            isSelected
              ? "opacity-100 bg-accent-teal text-white"
              : "opacity-0 group-hover:opacity-60 bg-black/60 text-white"
          }`}
        >
          <CheckCircle size={18} weight="fill" />
        </div>

        {/* Video badge */}
        {file.file_type === "video" && (
          <div className="absolute bottom-2 left-2 bg-black/70 rounded p-1 text-[10px] flex items-center gap-1 text-white uppercase font-mono">
            <Play size={10} weight="fill" />
            <span>Video</span>
          </div>
        )}
      </div>

      {/* Metadata strip */}
      <div className="p-2 border-t border-border-subtle flex flex-col justify-between select-none">
        <p className="text-[11px] font-medium truncate text-text-primary mb-0.5" title={file.name}>
          {file.name}
        </p>
        <div className="flex justify-between items-center text-[10px] font-mono text-text-secondary">
          <span>{formatSize(file.size)}</span>
          <span>{formatDate(file.date)}</span>
        </div>
      </div>
    </div>
  );
};

// --------------------------------------------------------------------------
// VirtualGrid — row-virtualised container
// --------------------------------------------------------------------------
interface VirtualGridProps {
  files: MediaFile[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string, isShift: boolean) => void;
  onDoubleClick: (file: MediaFile) => void;
  selectMultiple: boolean;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export const VirtualGrid: React.FC<VirtualGridProps> = ({
  files,
  selectedIds,
  onToggleSelect,
  onDoubleClick,
  selectMultiple,
  setSelectedIds,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerWidth, setContainerWidth] = useState(800);
  const [containerHeight, setContainerHeight] = useState(600);

  const gap = 16;
  const padding = 32;
  const paddingOffset = 16;

  const columns = Math.max(1, Math.floor((containerWidth - padding + gap) / (150 + gap)));
  const totalGapsWidth = (columns - 1) * gap;
  const itemWidth = Math.floor((containerWidth - padding - totalGapsWidth) / columns);
  const itemHeight = itemWidth + 20;

  // Drag select states
  const [dragRect, setDragRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; scrollTop: number } | null>(null);
  const initialSelectedRef = useRef<Set<string>>(new Set());
  const mouseClientXRef = useRef<number | null>(null);
  const mouseClientYRef = useRef<number | null>(null);

  const updateDragAndSelection = useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current;
    const start = dragStartRef.current;
    if (!container || !start) return;

    const rect = container.getBoundingClientRect();
    const currentScrollTop = container.scrollTop;

    const currentX = clientX - rect.left + container.scrollLeft;
    const currentY = clientY - rect.top + currentScrollTop;

    const x = Math.min(start.x, currentX);
    const y = Math.min(start.y, currentY);
    const w = Math.abs(start.x - currentX);
    const h = Math.abs(start.y - currentY);

    setDragRect({ x, y, w, h });

    const rowHeightVal = itemHeight + gap;
    const nextSelected = new Set(initialSelectedRef.current);

    files.forEach((file, index) => {
      const row = Math.floor(index / columns);
      const col = index % columns;

      const itemLeft = paddingOffset + col * (itemWidth + gap);
      const itemTop = row * rowHeightVal;
      const itemRight = itemLeft + itemWidth;
      const itemBottom = itemTop + itemHeight;

      const intersects = itemLeft < x + w && itemRight > x && itemTop < y + h && itemBottom > y;
      const isInitiallySelected = initialSelectedRef.current.has(file.id);

      if (intersects) {
        if (isInitiallySelected) {
          nextSelected.delete(file.id);
        } else {
          nextSelected.add(file.id);
        }
      } else {
        if (isInitiallySelected) {
          nextSelected.add(file.id);
        } else {
          nextSelected.delete(file.id);
        }
      }
    });

    setSelectedIds(nextSelected);
  }, [files, containerWidth, setSelectedIds]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!selectMultiple) return;
    if (e.button !== 0) return;

    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input")) return;

    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const scrollTopVal = container.scrollTop;
    
    const startX = e.clientX - rect.left + container.scrollLeft;
    const startY = e.clientY - rect.top + scrollTopVal;

    dragStartRef.current = { x: startX, y: startY, scrollTop: scrollTopVal };
    initialSelectedRef.current = new Set(selectedIds);
    mouseClientXRef.current = e.clientX;
    mouseClientYRef.current = e.clientY;
    setDragRect({ x: startX, y: startY, w: 0, h: 0 });
    e.preventDefault();
  };

  useEffect(() => {
    if (!dragRect) {
      mouseClientXRef.current = null;
      mouseClientYRef.current = null;
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      mouseClientXRef.current = e.clientX;
      mouseClientYRef.current = e.clientY;
      updateDragAndSelection(e.clientX, e.clientY);
    };

    const handleMouseUp = () => {
      setDragRect(null);
      dragStartRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    // Auto-scroll loop
    let animationFrameId: number;

    const scrollLoop = () => {
      const container = containerRef.current;
      if (!container || mouseClientXRef.current === null || mouseClientYRef.current === null) {
        animationFrameId = requestAnimationFrame(scrollLoop);
        return;
      }

      const rect = container.getBoundingClientRect();
      const y = mouseClientYRef.current;
      const x = mouseClientXRef.current;
      const threshold = 40; // px from edge to start scrolling
      const maxSpeed = 15; // pixels per frame

      let speed = 0;
      if (y < rect.top + threshold) {
        const diff = (rect.top + threshold) - y;
        speed = -Math.min(maxSpeed, Math.max(1, diff * 0.4));
      } else if (y > rect.bottom - threshold) {
        const diff = y - (rect.bottom - threshold);
        speed = Math.min(maxSpeed, Math.max(1, diff * 0.4));
      }

      if (speed !== 0) {
        container.scrollTop += speed;
        updateDragAndSelection(x, y);
      }

      animationFrameId = requestAnimationFrame(scrollLoop);
    };

    animationFrameId = requestAnimationFrame(scrollLoop);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      cancelAnimationFrame(animationFrameId);
    };
  }, [dragRect, updateDragAndSelection]);

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
        setContainerHeight(containerRef.current.clientHeight);
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    const observer = new ResizeObserver(handleResize);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => {
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
    };
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  const rows = Math.ceil(files.length / columns);
  const rowHeight = itemHeight + gap;
  const totalHeight = rows * rowHeight;

  // Render a buffer of ±2 rows beyond what's visible
  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - 2);
  const endRow = Math.min(rows, Math.ceil((scrollTop + containerHeight) / rowHeight) + 2);

  const visibleItems: { item: MediaFile; index: number }[] = [];
  for (let r = startRow; r < endRow; r++) {
    for (let c = 0; c < columns; c++) {
      const idx = r * columns + c;
      if (idx < files.length) {
        visibleItems.push({ item: files[idx], index: idx });
      }
    }
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto bg-grid-bg p-4 relative select-none"
      onScroll={handleScroll}
      onMouseDown={handleMouseDown}
    >
      {files.length === 0 ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted">
          <p className="text-lg">No media files discovered in this folder</p>
          <p className="text-sm mt-1">Connect a device and select DCIM or Pictures</p>
        </div>
      ) : (
        <div style={{ height: `${totalHeight}px`, width: "100%", position: "relative" }}>
          {visibleItems.map(({ item, index }) => {
            const row = Math.floor(index / columns);
            const col = index % columns;
            return (
              <LazyThumbnail
                key={item.id}
                file={item}
                isSelected={selectedIds.has(item.id)}
                onToggleSelect={onToggleSelect}
                onDoubleClick={onDoubleClick}
                width={itemWidth}
                height={itemHeight}
                left={paddingOffset + col * (itemWidth + gap)}
                top={row * rowHeight}
              />
            );
          })}

          {/* Visual drag selection bounding box */}
          {dragRect && (
            <div
              className="absolute border border-accent-teal bg-accent-teal/15 pointer-events-none rounded z-30 shadow-[0_0_8px_rgba(235,94,40,0.2)]"
              style={{
                left: `${dragRect.x}px`,
                top: `${dragRect.y}px`,
                width: `${dragRect.w}px`,
                height: `${dragRect.h}px`,
              }}
            />
          )}
        </div>
      )}
    </div>
  );
};
