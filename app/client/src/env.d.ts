interface NcSenderAPI {
  theme: {
    shouldUseDark: () => boolean;
  };
}

declare global {
  interface Window {
    ncSender?: NcSenderAPI;
  }
}

export {};
