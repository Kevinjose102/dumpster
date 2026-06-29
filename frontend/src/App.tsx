import { useEffect, useState, useMemo, useRef } from "react";
import { Sidebar } from "./components/Sidebar";
import { VirtualGrid } from "./components/VirtualGrid";
import { ContextPanel } from "./components/ContextPanel";
import { RecoveryBinModal } from "./components/RecoveryBinModal";
import { SettingsModal } from "./components/SettingsModal";
import { api } from "./api";
import type { MediaFile, AppStatus } from "./api";
import {
  ArrowClockwise,
  Gear,
  ClockCounterClockwise,
  DeviceMobile,
  Trash,
  X,
} from "@phosphor-icons/react";


export default function App() {
  const [device, setDevice] = useState<{ id: string; name: string; type: string } | null>(null);
  const [allFiles, setAllFiles] = useState<MediaFile[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState<string>("DCIM");
  const [activeDateFilter, setActiveDateFilter] = useState<string>("All");
  const [sortBy, setSortBy] = useState<string>("date_desc");
  const [selectMultiple, setSelectMultiple] = useState<boolean>(false);
  
  // Modals
  const [isRecoveryOpen, setIsRecoveryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [recoveryCount, setRecoveryCount] = useState(0);

  // App status and stats
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<MediaFile | null>(null);
  
  // Loading screen states
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState("Initializing cleanup manager...");
  
  // Track last clicked index for Shift+Click range select
  const lastClickedIdRef = useRef<string | null>(null);

  // Load active connection on startup
  const fetchStatus = async () => {
    try {
      const data = await api.getStatus();
      setStatus(data);
      
      const binFiles = await api.getRecoveryBin();
      setRecoveryCount(binFiles.length);
    } catch (e) {
      console.error("Error loading status:", e);
    }
  };

  const scanForDevices = async () => {
    try {
      setLoading(true);
      const devices = await api.getDevices();
      if (devices.length > 0) {
        const active = devices[0];
        setDevice(active);
        
        // Trigger initial files scan
        const filesData = await api.scanDevice(active.id, active.name);
        setAllFiles(filesData);
        
        // Auto select first file preview
        if (filesData.length > 0) {
          // Do not override if already selected
        }
      }
      setLoading(false);
    } catch (e) {
      console.error("Error scanning devices:", e);
      setLoading(false);
      throw e;
    }
  };

  useEffect(() => {
    let progressTimer: number;
    let progressVal = 0;
    
    const runProgress = () => {
      progressTimer = window.setInterval(() => {
        if (progressVal < 90) {
          progressVal += Math.random() * 8 + 2;
          setLoadingProgress(Math.min(90, Math.floor(progressVal)));
          
          if (progressVal > 70) {
            setLoadingStatus("Scanning directories & folders...");
          } else if (progressVal > 45) {
            setLoadingStatus("Detecting connected USB devices...");
          } else if (progressVal > 20) {
            setLoadingStatus("Connecting to MTP helper server...");
          }
        }
      }, 150);
    };
    
    runProgress();

    const initScan = async () => {
      try {
        await scanForDevices();
        clearInterval(progressTimer);
        setLoadingProgress(100);
        setLoadingStatus("Initialization complete!");
        setTimeout(() => {
          setInitialLoading(false);
        }, 600);
      } catch (e) {
        clearInterval(progressTimer);
        setLoadingProgress(100);
        setLoadingStatus("Checking system connection...");
        setTimeout(() => {
          setInitialLoading(false);
        }, 1000);
      }
    };
    
    initScan();
    
    // Poll status periodically (every 10s)
    const interval = setInterval(fetchStatus, 10000);
    return () => {
      clearInterval(progressTimer);
      clearInterval(interval);
    };
  }, []);

  // Compute category statistics dynamically
  const categoriesStats = useMemo(() => {
    const defaultStats = [
      { name: "DCIM", count: 0, size: 0 },
      { name: "Pictures", count: 0, size: 0 },
    ];

    allFiles.forEach((file) => {
      const cat = defaultStats.find((c) => c.name === file.category);
      if (cat) {
        cat.count += 1;
        cat.size += file.size;
      }
    });

    return defaultStats;
  }, [allFiles]);

  // Filter files by active category
  const categoryFiles = useMemo(() => {
    return allFiles.filter((f) => f.category === activeCategory);
  }, [allFiles, activeCategory]);

  // Filter and Sort files
  const filteredFiles = useMemo(() => {
    let files = [...categoryFiles];

    if (activeDateFilter !== "All") {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      const sevenDaysAgo = new Date(todayStart);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const thirtyDaysAgo = new Date(todayStart);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      files = files.filter((file) => {
        const fdate = new Date(file.date);
        
        switch (activeDateFilter) {
          case "Today":
            return fdate >= todayStart;
          case "Last 7 Days":
            return fdate >= sevenDaysAgo;
          case "Last 30 Days":
            return fdate >= thirtyDaysAgo;
          case "This Month":
            return fdate.getMonth() === now.getMonth() && fdate.getFullYear() === now.getFullYear();
          case "Older":
            return fdate < thirtyDaysAgo;
          default:
            return true;
        }
      });
    }

    // Sort files
    files.sort((a, b) => {
      const timeA = new Date(a.date).getTime();
      const timeB = new Date(b.date).getTime();
      
      switch (sortBy) {
        case "date_desc":
          return timeB - timeA;
        case "date_asc":
          return timeA - timeB;
        case "size_desc":
          return b.size - a.size;
        case "size_asc":
          return a.size - b.size;
        default:
          return 0;
      }
    });

    return files;
  }, [categoryFiles, activeDateFilter, sortBy]);

  // Handle shift-click range select or normal toggle select
  const handleToggleSelect = (id: string, isShift: boolean) => {
    if (!selectMultiple && !isShift) {
      // Single-select preview mode
      if (selectedIds.has(id) && selectedIds.size === 1) {
        // clicking again toggles selection off
        setSelectedIds(new Set());
      } else {
        setSelectedIds(new Set([id]));
      }
      lastClickedIdRef.current = id;
      return;
    }

    // Select Multiple is true, or Shift key is held (multi-select mode)
    const nextSelected = new Set(selectedIds);
    
    if (isShift && lastClickedIdRef.current && lastClickedIdRef.current !== id) {
      // Shift key is held, select range
      const lastIndex = filteredFiles.findIndex((f) => f.id === lastClickedIdRef.current);
      const currentIndex = filteredFiles.findIndex((f) => f.id === id);

      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);

        const rangeIds = filteredFiles.slice(start, end + 1).map((f) => f.id);
        
        // Check if current is already selected, if yes we might want to select all, otherwise toggle
        const isCurrentlySelected = selectedIds.has(id);
        
        rangeIds.forEach((rid) => {
          if (isCurrentlySelected) {
            nextSelected.delete(rid);
          } else {
            nextSelected.add(rid);
          }
        });
      }
    } else {
      // Toggle single item
      if (nextSelected.has(id)) {
        nextSelected.delete(id);
      } else {
        nextSelected.add(id);
      }
    }

    setSelectedIds(nextSelected);
    lastClickedIdRef.current = id;
  };

  // Archive Selected Files
  const handleArchive = async () => {
    if (selectedIds.size === 0) return;
    try {
      setLoading(true);
      const res = await api.archiveFiles(Array.from(selectedIds));
      alert(`Archived ${res.success_count} files successfully!`);
      setSelectedIds(new Set());
      lastClickedIdRef.current = null;
      
      // Refresh scan
      if (device) {
        const filesData = await api.scanDevice(device.id, device.name);
        setAllFiles(filesData);
      }
      await fetchStatus();
    } catch (e) {
      alert("Archive failed: " + e);
    } finally {
      setLoading(false);
    }
  };

  // Delete Selected Files
  const handleDelete = async () => {
    if (selectedIds.size === 0) return;
    const confirmText = `Are you sure you want to delete ${selectedIds.size} files from the phone?\n\nFiles will be moved to the local PC Recovery Bin for safety.`;
    if (!window.confirm(confirmText)) return;

    try {
      setLoading(true);
      const res = await api.deleteFiles(Array.from(selectedIds));
      alert(`Deleted ${res.success_count} files successfully!`);
      setSelectedIds(new Set());
      lastClickedIdRef.current = null;

      // Refresh scan
      if (device) {
        const filesData = await api.scanDevice(device.id, device.name);
        setAllFiles(filesData);
      }
      await fetchStatus();
    } catch (e) {
      alert("Deletion failed: " + e);
    } finally {
      setLoading(false);
    }
  };

  // Undo Last Action
  const handleUndo = async () => {
    try {
      setLoading(true);
      const res = await api.undoLastOperation();
      alert(`Undo Successful! Restored ${res.success_count} files from last ${res.action_undone} operation.`);
      
      // Refresh scan
      if (device) {
        const filesData = await api.scanDevice(device.id, device.name);
        setAllFiles(filesData);
      }
      setSelectedIds(new Set());
      lastClickedIdRef.current = null;
      await fetchStatus();
    } catch (e) {
      alert("Undo failed: " + e);
    } finally {
      setLoading(false);
    }
  };

  // Keyboard Event Handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. Ctrl+A (Select All visible files)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        // Only trigger if we are not typing inside an input field
        if (document.activeElement?.tagName !== "INPUT") {
          e.preventDefault();
          const allVisibleIds = filteredFiles.map((f) => f.id);
          setSelectedIds(new Set(allVisibleIds));
        }
      }

      // 2. Escape (Deselect All / Close Preview)
      if (e.key === "Escape") {
        setPreviewFile((prev) => {
          if (prev) return null;
          setSelectedIds(new Set());
          lastClickedIdRef.current = null;
          return null;
        });
      }

      // 3. Delete (Delete selected files)
      if (e.key === "Delete" && selectedIds.size > 0) {
        if (document.activeElement?.tagName !== "INPUT") {
          handleDelete();
        }
      }

      // 4. Enter / A (Archive selected files)
      if (e.key === "Enter" && selectedIds.size > 0) {
        if (document.activeElement?.tagName !== "INPUT") {
          handleArchive();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filteredFiles, selectedIds, previewFile]);

  // Compute selected stats
  const selectedCount = selectedIds.size;
  const selectedSize = useMemo(() => {
    return allFiles
      .filter((f) => selectedIds.has(f.id))
      .reduce((sum, f) => sum + f.size, 0);
  }, [allFiles, selectedIds]);

  const selectedFile = useMemo(() => {
    if (selectedCount === 1) {
      const selectedId = Array.from(selectedIds)[0];
      return allFiles.find((f) => f.id === selectedId) || null;
    }
    return null;
  }, [allFiles, selectedIds, selectedCount]);

  const formatStorage = (bytes: number) => {
    if (bytes === 0) return "0.0 GB";
    const gb = bytes / (1024 * 1024 * 1024);
    return gb.toFixed(1) + " GB";
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-grid-bg text-text-primary relative">
      
      {/* Starting Loading Overlay */}
      {initialLoading && (
        <div className="fixed inset-0 z-50 bg-[#060708] flex flex-col items-center justify-center select-none transition-all duration-500">
          <div className="flex flex-col items-center max-w-sm w-full text-center p-6">
            {/* SVG Logo */}
            <svg viewBox="0 0 100 100" className="w-20 h-20 animate-pulse text-accent-teal mb-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M50 15 L80 30 L50 45 L20 30 Z" className="opacity-90 stroke-accent-teal" />
              <path d="M20 30 L20 70 L50 85 L80 70 L80 30" className="stroke-accent-teal" />
              <path d="M50 45 L50 85" className="stroke-accent-teal/55" />
              <path d="M35 52 L50 60 L65 52" className="stroke-accent-teal/40" />
              <path d="M35 62 L50 70 L65 62" className="stroke-accent-teal/40" />
            </svg>
            
            {/* App Name */}
            <h1 className="text-xl font-bold tracking-[0.3em] uppercase text-text-primary mt-2">
              DUMPSTER
            </h1>
            <p className="text-[9px] text-text-muted font-mono tracking-widest mt-1 uppercase">
              Android Storage Cleanup Manager
            </p>
            
            {/* Progress Bar Container */}
            <div className="w-56 h-[3px] bg-card-bg rounded-full overflow-hidden border border-border-subtle/30 mt-8">
              <div 
                className="h-full bg-accent-teal rounded-full transition-all duration-300 ease-out" 
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
            
            {/* Progress Status */}
            <span className="text-[8px] text-text-muted uppercase font-mono tracking-[0.2em] mt-3 block min-h-[12px]">
              {loadingStatus}
            </span>
            <span className="text-[10px] text-accent-teal font-mono font-bold mt-1 block">
              {loadingProgress}%
            </span>
          </div>
        </div>
      )}
      
      {/* 1. Left Sidebar */}
      <Sidebar
        categories={categoriesStats}
        activeCategory={activeCategory}
        onSelectCategory={(cat) => {
          setActiveCategory(cat);
          setActiveDateFilter("All"); // Reset date filter on category change
          setSelectedIds(new Set());
          lastClickedIdRef.current = null;
        }}
        activeFilter={activeDateFilter}
        onFilterChange={setActiveDateFilter}
        sortBy={sortBy}
        onSortChange={setSortBy}
        selectMultiple={selectMultiple}
        onSelectMultipleChange={setSelectMultiple}
      />

      {/* Center + Context Panel Container */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Sticky Top Bar / Stats Header */}
        <header className="h-16 border-b border-border-subtle bg-panel-bg flex items-center justify-between px-6 select-none z-10">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <DeviceMobile size={18} className="text-accent-teal" />
              <span className="text-xs font-semibold uppercase tracking-wider">
                {device ? device.name : "Detecting USB device..."}
              </span>
              {status?.is_mock && (
                <span className="bg-card-bg border border-border-subtle px-1.5 py-0.5 rounded text-[8px] font-mono uppercase text-text-secondary tracking-wider font-semibold">
                  Mock Mode
                </span>
              )}
            </div>

            {/* Session Statistics */}
            {status && (
              <div className="flex items-center gap-4 border-l border-border-subtle pl-4 text-[10px] font-mono text-text-secondary uppercase">
                <div>
                  Moved: <span className="font-semibold text-text-primary">{status.stats.moved}</span>
                </div>
                <div>
                  Deleted: <span className="font-semibold text-text-primary">{status.stats.deleted}</span>
                </div>
                <div>
                  Freed: <span className="font-semibold text-text-primary">{formatStorage(status.stats.freed_bytes)}</span>
                </div>
                <div>
                  Duration: <span className="font-semibold text-text-primary">{status.stats.duration_minutes} min</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
             {/* Undo Action */}
            <button
              onClick={handleUndo}
              title="Undo Last Operation (Archive / Delete)"
              className="flex items-center gap-1 bg-card-bg hover:bg-white/[0.04] border border-border-subtle text-text-secondary hover:text-text-primary px-3 py-1.5 rounded text-[10px] uppercase font-mono tracking-wider font-semibold transition-all"
            >
              <ClockCounterClockwise size={12} />
              Undo Last Action
            </button>

            {/* Reload Scanner */}
            <button
              onClick={scanForDevices}
              disabled={loading}
              title="Scan Connected Devices"
              className="p-1.5 bg-card-bg border border-border-subtle text-text-secondary hover:text-text-primary rounded hover:bg-white/[0.04] transition-all disabled:opacity-50"
            >
              <ArrowClockwise size={14} className={loading ? "animate-spin" : ""} />
            </button>

            {/* Settings button */}
            <button
              onClick={() => setIsSettingsOpen(true)}
              title="Application Settings"
              className="p-1.5 bg-card-bg border border-border-subtle text-text-secondary hover:text-text-primary rounded hover:bg-white/[0.04] transition-all"
            >
              <Gear size={14} />
            </button>
          </div>
        </header>

        {/* 2. Main Media Grid (Center) */}
        <div className="flex-1 flex min-h-0 relative">
          
          {loading && allFiles.length === 0 ? (
            <div className="absolute inset-0 bg-grid-bg/90 flex flex-col items-center justify-center text-text-muted z-20">
              <ArrowClockwise size={32} className="animate-spin text-accent-teal mb-3" />
              <p className="font-mono text-xs uppercase tracking-wider">Scanning MTP directories...</p>
            </div>
          ) : (
            <VirtualGrid
              files={filteredFiles}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onDoubleClick={(file) => {
                setPreviewFile(file);
                if (!selectMultiple) {
                  setSelectedIds(new Set());
                }
              }}
              selectMultiple={selectMultiple}
              setSelectedIds={setSelectedIds}
            />
          )}

          {/* 3. Right Contextual Panel */}
          <ContextPanel
            selectedCount={selectedCount}
            selectedSize={selectedSize}
            selectedFile={selectedFile}
            onArchive={handleArchive}
            onDelete={handleDelete}
            loading={loading}
          />
        </div>

        {/* Bottom Status bar (hosts Recovery Bin access) */}
        <footer className="h-10 border-t border-border-subtle bg-panel-bg flex items-center justify-between px-6 select-none z-10 text-[10px] font-mono uppercase text-text-secondary">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-teal animate-pulse" />
            <span>
              {device ? `CONNECTED TO ${device.name}` : "SCANNING USB INTERFACES..."}
            </span>
          </div>

          <div className="flex items-center gap-4">
            {/* Quick selection summary stats */}
            {selectedCount > 0 && (
              <span className="text-text-muted">
                {selectedCount} files chosen ({formatStorage(selectedSize)})
              </span>
            )}
            
            {/* Recovery Bin button */}
            <button
              onClick={() => setIsRecoveryOpen(true)}
              className="flex items-center gap-1.5 text-text-secondary hover:text-text-primary transition-colors py-1 px-2.5 rounded hover:bg-white/[0.03]"
            >
              <Trash size={12} />
              <span>Recovery Bin</span>
              <span className="bg-card-bg px-1.5 py-0.2 rounded border border-border-subtle text-[9px] font-bold text-accent-teal font-mono">
                {recoveryCount}
              </span>
            </button>
          </div>
        </footer>

      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* Recovery Bin Modal */}
      <RecoveryBinModal
        isOpen={isRecoveryOpen}
        onClose={() => setIsRecoveryOpen(false)}
        onRefreshStats={fetchStatus}
      />

      {/* Lightbox / Picture Preview Modal */}
      {previewFile && (
        <div 
          onClick={() => setPreviewFile(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 select-none cursor-pointer"
        >
          <button
            onClick={() => setPreviewFile(null)}
            className="absolute top-6 right-6 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-default"
            title="Close Preview (Esc)"
          >
            <X size={20} />
          </button>
          
          <div 
            onClick={(e) => e.stopPropagation()}
            className="max-w-[90%] max-h-[85%] flex flex-col items-center gap-4 cursor-default"
          >
            {previewFile.file_type === "video" ? (
              <video
                src={api.getFileUrl(previewFile.id, previewFile.original_path)}
                controls
                autoPlay
                className="max-w-full max-h-[70vh] rounded shadow-2xl"
              />
            ) : (
              <img
                src={api.getFileUrl(previewFile.id, previewFile.original_path)}
                alt={previewFile.name}
                className="max-w-full max-h-[70vh] rounded shadow-2xl object-contain"
              />
            )}
            
            <div className="text-center text-white">
              <p className="text-sm font-semibold truncate max-w-md">{previewFile.name}</p>
              <p className="text-[10px] font-mono text-text-secondary mt-1 uppercase">
                {previewFile.category} / {previewFile.subfolder || "Root"} • {formatStorage(previewFile.size)} • {new Date(previewFile.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "numeric" })}
              </p>
            </div>

            <div className="flex gap-4 mt-2">
              <button
                onClick={async () => {
                  const fid = previewFile.id;
                  setPreviewFile(null);
                  try {
                    setLoading(true);
                    await api.archiveFiles([fid]);
                    alert(`Archived successfully!`);
                    if (device) {
                      const filesData = await api.scanDevice(device.id, device.name);
                      setAllFiles(filesData);
                    }
                    await fetchStatus();
                  } catch (e) {
                    alert("Archive failed: " + e);
                  } finally {
                    setLoading(false);
                  }
                }}
                className="flex items-center gap-2 bg-accent-green hover:bg-accent-green-hover text-white text-xs font-semibold py-2 px-6 rounded transition-colors uppercase tracking-wider"
              >
                Archive to PC
              </button>
              <button
                onClick={async () => {
                  const fid = previewFile.id;
                  if (!window.confirm("Are you sure you want to delete this file from the phone?\nIt will be moved to the local PC Recovery Bin.")) return;
                  setPreviewFile(null);
                  try {
                    setLoading(true);
                    await api.deleteFiles([fid]);
                    alert(`Deleted successfully!`);
                    if (device) {
                      const filesData = await api.scanDevice(device.id, device.name);
                      setAllFiles(filesData);
                    }
                    await fetchStatus();
                  } catch (e) {
                    alert("Deletion failed: " + e);
                  } finally {
                    setLoading(false);
                  }
                }}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold py-2 px-6 rounded transition-colors uppercase tracking-wider"
              >
                Delete from Phone
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
