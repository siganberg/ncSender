/*
 * This file is part of ncSender.
 *
 * ncSender is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * ncSender is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with ncSender. If not, see <https://www.gnu.org/licenses/>.
 */

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
