const API_BASE = "http://127.0.0.1:5000/api";

export interface MediaFile {
  id: string;
  name: string;
  original_path: string;
  size: number;
  date: string;
  category: string;
  file_type: "image" | "video";
  extension: string;
  subfolder?: string;
}

export interface SessionStats {
  moved: number;
  deleted: number;
  freed_bytes: number;
  duration_minutes: number;
}

export interface AppStatus {
  device_id: string | null;
  device_name: string;
  is_mock: boolean;
  stats: SessionStats;
}

export interface Settings {
  destinations: Record<string, string>;
  retention_days: number;
  recovery_bin_dir: string;
}

export interface RecoveryFile {
  id: string;
  name: string;
  original_path: string;
  original_device: string;
  size: number;
  category: string;
  deleted_at: string;
  bin_path: string;
}

export interface Transaction {
  id: string;
  timestamp: string;
  action: "archive" | "delete" | "restore";
  file_count: number;
  total_size: number;
  files: any[];
  details: any;
}

export const api = {
  async getStatus(): Promise<AppStatus> {
    const res = await fetch(`${API_BASE}/status`);
    return res.json();
  },

  async getSettings(): Promise<Settings> {
    const res = await fetch(`${API_BASE}/settings`);
    return res.json();
  },

  async saveSettings(settings: Partial<Settings>): Promise<Settings> {
    const res = await fetch(`${API_BASE}/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    const data = await res.json();
    return data.settings;
  },

  async getDevices(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/devices`);
    return res.json();
  },

  async scanDevice(deviceId: string, deviceName: string): Promise<MediaFile[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout
    try {
      const res = await fetch(`${API_BASE}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: deviceId, device_name: deviceName }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        console.error("Scan API returned error status:", res.status);
        return [];
      }
      const data = await res.json();
      console.log(`Scan returned ${data.length} files`);
      return data;
    } catch (e) {
      clearTimeout(timeoutId);
      console.error("Scan fetch failed:", e);
      return [];
    }
  },

  getThumbnailUrl(fileId: string, path: string, ext: string): string {
    return `${API_BASE}/thumbnail?id=${fileId}&path=${encodeURIComponent(path)}&ext=${encodeURIComponent(ext)}`;
  },

  getFileUrl(fileId: string, path: string): string {
    return `${API_BASE}/file?id=${fileId}&path=${encodeURIComponent(path)}`;
  },

  async archiveFiles(fileIds: string[]): Promise<any> {
    const res = await fetch(`${API_BASE}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_ids: fileIds }),
    });
    return res.json();
  },

  async deleteFiles(fileIds: string[]): Promise<any> {
    const res = await fetch(`${API_BASE}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_ids: fileIds }),
    });
    return res.json();
  },

  async getRecoveryBin(): Promise<RecoveryFile[]> {
    const res = await fetch(`${API_BASE}/recovery-bin`);
    return res.json();
  },

  async restoreRecoveryFiles(recoveryIds: string[]): Promise<any> {
    const res = await fetch(`${API_BASE}/recovery-bin/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recovery_ids: recoveryIds }),
    });
    return res.json();
  },

  async purgeRecoveryFiles(recoveryIds: string[]): Promise<any> {
    const res = await fetch(`${API_BASE}/recovery-bin/purge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recovery_ids: recoveryIds }),
    });
    return res.json();
  },

  async purgeAllRecoveryFiles(): Promise<any> {
    const res = await fetch(`${API_BASE}/recovery-bin/purge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    return res.json();
  },

  async getHistory(): Promise<Transaction[]> {
    const res = await fetch(`${API_BASE}/history`);
    return res.json();
  },

  async undoLastOperation(): Promise<any> {
    const res = await fetch(`${API_BASE}/undo`, {
      method: "POST",
    });
    return res.json();
  },
};
