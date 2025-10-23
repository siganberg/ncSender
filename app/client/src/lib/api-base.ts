const DEFAULT_PORT = 8090;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Resolve the API base URL for the ncSender backend.
 * When a port override is provided, the helper attempts to target that port
 * while respecting the current execution environment (Electron, dev server, production).
 */
export const getApiBaseUrl = (portOverride?: number): string => {
  const resolvedPort = isFiniteNumber(portOverride) ? portOverride : DEFAULT_PORT;

  if (typeof window === 'undefined') {
    return `http://localhost:${resolvedPort}`;
  }

  const { protocol, hostname, host, port } = window.location;

  if (protocol === 'file:') {
    return `http://localhost:${resolvedPort}`;
  }

  const isDev = import.meta && import.meta.env && import.meta.env.DEV;
  if (isDev || port === '5174') {
    const scheme = protocol === 'https:' ? 'https' : 'http';
    return `${scheme}://${hostname}:${resolvedPort}`;
  }

  if (isFiniteNumber(portOverride) && port !== String(resolvedPort)) {
    const scheme = protocol === 'https:' ? 'https' : 'http';
    return `${scheme}://${hostname}:${resolvedPort}`;
  }

  return '';
};

export const DEFAULT_API_PORT = DEFAULT_PORT;
