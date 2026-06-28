import React from "react";
import { Camera, Image, FolderOpen, CalendarBlank, ArrowsDownUp, CheckSquare } from "@phosphor-icons/react";

interface SidebarProps {
  categories: {
    name: string;
    count: number;
    size: number;
  }[];
  activeCategory: string;
  onSelectCategory: (name: string) => void;
  activeFilter: string;
  onFilterChange: (filter: string) => void;
  sortBy: string;
  onSortChange: (sort: string) => void;
  selectMultiple: boolean;
  onSelectMultipleChange: (val: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  categories,
  activeCategory,
  onSelectCategory,
  activeFilter,
  onFilterChange,
  sortBy,
  onSortChange,
  selectMultiple,
  onSelectMultipleChange,
}) => {
  const filterChips = [
    { label: "All", value: "All" },
    { label: "Today", value: "Today" },
    { label: "Last 7 Days", value: "Last 7 Days" },
    { label: "Last 30 Days", value: "Last 30 Days" },
    { label: "This Month", value: "This Month" },
    { label: "Older", value: "Older" },
  ];
  const getIcon = (name: string) => {
    switch (name) {
      case "DCIM":
        return <Camera size={18} />;
      case "Pictures":
        return <Image size={18} />;
      default:
        return <FolderOpen size={18} />;
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <div className="w-80 bg-panel-bg border-r border-border-subtle flex flex-col justify-between py-6">
      <div className="flex flex-col">
        {/* Logo */}
        <div className="px-6 mb-8 select-none">
          <h1 className="text-base font-bold tracking-[0.25em] text-accent-teal uppercase">
            Dumpster
          </h1>
          <p className="text-[10px] text-text-muted mt-1 uppercase font-mono tracking-[0.1em]">
            Android USB Cleanup
          </p>
        </div>

        {/* Folders */}
        <div className="px-4 mb-3">
          <p className="text-[9px] font-semibold text-text-muted uppercase tracking-[0.18em] px-1">
            Internal Storage
          </p>
        </div>
        <nav className="flex flex-col gap-1 px-3">
          {categories.map((cat) => {
            const isActive = cat.name === activeCategory;
            return (
              <button
                key={cat.name}
                onClick={() => onSelectCategory(cat.name)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded text-left transition-all ${isActive
                    ? "bg-accent-teal/10 border-l-2 border-accent-teal text-text-primary"
                    : "text-text-secondary hover:text-text-primary hover:bg-white/[0.02]"
                  }`}
              >
                <div className="flex items-center gap-3">
                  <span className={isActive ? "text-accent-teal" : "text-text-muted"}>
                    {getIcon(cat.name)}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-xs font-medium tracking-wide uppercase">{cat.name}</span>
                    <span className="text-[9px] text-text-muted font-mono">
                      All subfolders included
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end font-mono text-[10px] text-text-muted">
                  <span className="font-semibold text-text-secondary">{cat.count} files</span>
                  <span>{formatSize(cat.size)}</span>
                </div>
              </button>
            );
          })}
        </nav>

        {/* Select Multiple Mode Toggle */}
        <div className="px-4 mt-6 border-t border-border-subtle pt-6">
          <button
            onClick={() => onSelectMultipleChange(!selectMultiple)}
            className={`w-full flex items-center justify-between px-4 py-3 rounded text-left transition-all border ${
              selectMultiple
                ? "bg-accent-teal/15 border-accent-teal text-text-primary"
                : "border-border-subtle text-text-secondary hover:text-text-primary hover:bg-white/[0.02]"
            }`}
          >
            <div className="flex items-center gap-3">
              <CheckSquare size={16} className={selectMultiple ? "text-accent-teal" : "text-text-muted"} />
              <div className="flex flex-col">
                <span className="text-xs font-medium uppercase tracking-wide">Select Multiple</span>
                <span className="text-[9px] text-text-muted font-mono">
                  {selectMultiple ? "Multi-select & Drag-select active" : "Click card to single preview"}
                </span>
              </div>
            </div>
            {/* Simple Toggle Switch visual */}
            <div
              className={`w-8 h-4 rounded-full p-0.5 transition-colors duration-200 ${
                selectMultiple ? "bg-accent-teal" : "bg-black/40 border border-border-subtle"
               }`}
            >
              <div
                className={`w-3 h-3 rounded-full bg-white transition-transform duration-200 ${
                  selectMultiple ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </div>
          </button>
        </div>

        {/* Date Filter */}
        <div className="px-4 mt-6 border-t border-border-subtle pt-6">
          <p className="text-[9px] font-semibold text-text-muted uppercase tracking-[0.18em] px-1 mb-3 flex items-center gap-1.5">
            <CalendarBlank size={12} />
            Filter Grid By Date
          </p>
          <div className="flex flex-wrap gap-2 px-1">
            {filterChips.map((chip) => {
              const isActive = activeFilter === chip.value;
              return (
                <button
                  key={chip.value}
                  onClick={() => onFilterChange(chip.value)}
                  className={`text-[9px] uppercase font-mono px-2.5 py-1.5 rounded border transition-all ${
                    isActive
                      ? "bg-accent-teal/15 border-accent-teal text-text-primary font-semibold"
                      : "border-border-subtle text-text-secondary hover:text-text-primary hover:border-text-secondary"
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Sort By */}
        <div className="px-4 mt-6 border-t border-border-subtle pt-6">
          <p className="text-[9px] font-semibold text-text-muted uppercase tracking-[0.18em] px-1 mb-3 flex items-center gap-1.5">
            <ArrowsDownUp size={12} />
            Sort Grid By
          </p>
          <div className="flex flex-wrap gap-2 px-1">
            {[
              { label: "Newest", value: "date_desc" },
              { label: "Oldest", value: "date_asc" },
              { label: "Largest", value: "size_desc" },
              { label: "Smallest", value: "size_asc" },
            ].map((chip) => {
              const isActive = sortBy === chip.value;
              return (
                <button
                  key={chip.value}
                  onClick={() => onSortChange(chip.value)}
                  className={`text-[9px] uppercase font-mono px-2.5 py-1.5 rounded border transition-all ${
                    isActive
                      ? "bg-accent-teal/15 border-accent-teal text-text-primary font-semibold"
                      : "border-border-subtle text-text-secondary hover:text-text-primary hover:border-text-secondary"
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Keyboard shortcuts panel at bottom */}
      <div className="px-6 select-none border-t border-border-subtle pt-6 mt-6 mx-3">
        <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.15em] mb-3">
          Keyboard Shortcuts
        </h3>
        <div className="flex flex-col gap-2 text-[10px] font-mono text-text-secondary">
          <div className="flex justify-between items-center">
            <span>Select All</span>
            <kbd className="bg-[#1f2025] px-1.5 py-0.5 rounded border border-border-subtle text-text-primary">
              Ctrl+A
            </kbd>
          </div>
          <div className="flex justify-between items-center">
            <span>Deselect All</span>
            <kbd className="bg-[#1f2025] px-1.5 py-0.5 rounded border border-border-subtle text-text-primary">
              Esc
            </kbd>
          </div>
          <div className="flex justify-between items-center">
            <span>Archive Selected</span>
            <kbd className="bg-[#1f2025] px-1.5 py-0.5 rounded border border-border-subtle text-text-primary">
              Enter
            </kbd>
          </div>
          <div className="flex justify-between items-center">
            <span>Delete Selected</span>
            <kbd className="bg-[#1f2025] px-1.5 py-0.5 rounded border border-border-subtle text-text-primary">
              Delete
            </kbd>
          </div>
          <div className="flex justify-between items-center mt-1">
            <span>Range Select</span>
            <span className="text-text-muted text-[9px] uppercase font-sans">Shift + Click</span>
          </div>
        </div>
      </div>
    </div>
  );
};
