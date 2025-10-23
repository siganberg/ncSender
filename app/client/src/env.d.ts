interface NcSenderAPI {
  theme: {
    shouldUseDark: () => boolean;
  };
  getApiBaseUrl?: (portOverride?: number) => string;
}

declare global {
  interface Window {
    ncSender?: NcSenderAPI;
  }
}

export {};
