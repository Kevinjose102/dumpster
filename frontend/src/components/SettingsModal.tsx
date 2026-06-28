import React, { useState, useEffect } from "react";
import { api } from "../api";
import type { Settings } from "../api";
import { X, FolderOpen, FloppyDisk } from "@phosphor-icons/react";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      api.getSettings().then(setSettings);
    }
  }, [isOpen]);

  if (!isOpen || !settings) return null;

  const handleDestinationChange = (cat: string, value: string) => {
    setSettings({
      ...settings,
      destinations: {
        ...settings.destinations,
        [cat]: value,
      },
    });
  };

  const handleRetentionChange = (val: number) => {
    setSettings({
      ...settings,
      retention_days: val,
    });
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      await api.saveSettings(settings);
      alert("Settings saved successfully!");
      onClose();
    } catch (e) {
      alert("Failed to save settings: " + e);
    } finally {
      setLoading(false);
    }
  };

  const categories = Object.keys(settings.destinations);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6 animate-fade-in select-none">
      <div className="bg-panel-bg w-full max-w-xl max-h-[85vh] rounded border border-border-subtle flex flex-col justify-between overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center bg-black/10">
          <div>
            <h2 className="text-sm font-semibold tracking-wider text-text-primary uppercase">
              Application Settings
            </h2>
            <p className="text-[10px] text-text-muted mt-0.5 uppercase tracking-wide font-mono">
              Configure PC Archive destinations and Recovery Bin parameters
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary p-1 rounded hover:bg-white/[0.05] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Settings Form */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
          {/* Preset Destination Folders */}
          <div>
            <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.15em] mb-4 flex items-center gap-1.5">
              <FolderOpen size={12} />
              Category Destination Folders
            </h3>
            
            <div className="flex flex-col gap-4">
              {categories.map((cat) => (
                <div key={cat} className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-mono text-text-secondary font-semibold">
                    {cat}
                  </label>
                  <input
                    type="text"
                    value={settings.destinations[cat]}
                    onChange={(e) => handleDestinationChange(cat, e.target.value)}
                    className="bg-grid-bg border border-border-subtle text-text-primary text-xs rounded p-2.5 font-mono focus:outline-none focus:border-accent-teal focus:ring-1 focus:ring-accent-teal"
                  />
                </div>
              ))}
            </div>
          </div>

          <hr className="border-border-subtle" />

          {/* Recovery Bin Settings */}
          <div className="flex flex-col gap-4">
            <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-[0.15em] mb-1">
              Recovery Bin Settings
            </h3>
            
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase font-mono text-text-secondary font-semibold">
                Retention Window
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="90"
                  value={settings.retention_days}
                  onChange={(e) => handleRetentionChange(parseInt(e.target.value) || 7)}
                  className="bg-grid-bg border border-border-subtle text-text-primary text-xs rounded p-2.5 w-24 font-mono focus:outline-none focus:border-accent-teal"
                />
                <span className="text-xs text-text-secondary uppercase font-mono text-[10px]">
                  Days (files automatically purged after this period)
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase font-mono text-text-secondary font-semibold">
                Recovery Bin Folder (PC)
              </label>
              <input
                type="text"
                value={settings.recovery_bin_dir}
                disabled
                className="bg-grid-bg/50 border border-border-subtle/50 text-text-muted text-xs rounded p-2.5 font-mono cursor-not-allowed"
              />
              <span className="text-[9px] text-text-muted uppercase font-mono mt-0.5">
                Path managed dynamically based on partition availability
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border-subtle flex justify-end gap-3 bg-black/10">
          <button
            onClick={onClose}
            className="bg-card-bg hover:bg-card-hover text-text-primary text-[10px] font-semibold px-4 py-2 rounded transition-colors uppercase tracking-wider font-mono border border-border-subtle"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex items-center gap-1.5 bg-accent-teal hover:bg-accent-teal-hover text-white text-[10px] font-semibold px-4 py-2 rounded transition-colors uppercase tracking-wider font-mono disabled:opacity-50"
          >
            <FloppyDisk size={12} />
            {loading ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
};
