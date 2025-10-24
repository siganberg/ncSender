declare global {
  interface Window {
    ncSender?: NcSenderAPI;
  }
}

interface UpdateAvailablePayload {
  version: string | null;
  releaseName?: string | null;
  releaseDate?: string | null;
  releaseNotes?: string | null;
  channel?: string;
  canInstall?: boolean;
  currentVersion?: string;
  downloadPath?: string;
}

interface UpdateProgressPayload {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond?: number;
  channel?: string;
}

interface NcSenderUpdatesAPI {
  checkForUpdates: () => Promise<any>;
  downloadUpdate: (options?: { install?: boolean }) => Promise<any>;
  installUpdate: () => Promise<any>;
  onChecking: (callback: (payload: any) => void) => () => void;
  onAvailable: (callback: (payload: UpdateAvailablePayload) => void) => () => void;
  onNotAvailable: (callback: (payload: any) => void) => () => void;
  onError: (callback: (payload: { message: string; channel?: string }) => void) => () => void;
  onDownloadStarted: (callback: (payload: any) => void) => () => void;
  onDownloadProgress: (callback: (payload: UpdateProgressPayload) => void) => () => void;
  onDownloaded: (callback: (payload: UpdateAvailablePayload & { downloadedAt?: string }) => void) => () => void;
}

interface NcSenderAPI {
  theme: {
    shouldUseDark: () => boolean;
  };
  updates?: NcSenderUpdatesAPI;
}

export {};
