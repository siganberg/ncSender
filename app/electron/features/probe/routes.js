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

import { Router } from 'express';
import { generateProbeCode, validateProbeOptions } from './probing-utils.js';
import { createLogger } from '../../core/logger.js';

const { log, error: logError } = createLogger('Probe');

export function createProbeRoutes(cncController, serverState, broadcast) {
  const router = Router();

  const setProbingStatus = (enabled) => {
    serverState.machineState.isProbing = enabled;
    broadcast('server-state-updated', serverState);
  };

  /**
   * Start a probing operation
   * POST /api/probe/start
   */
  router.post('/start', async (req, res) => {
    if (serverState.machineState.isProbing) {
      return res.status(409).json({
        success: false,
        error: 'Probe operation already in progress'
      });
    }

    const { options, errors } = validateProbeOptions(req.body || {});

    if (errors.length) {
      return res.status(400).json({
        success: false,
        error: errors.join('; ')
      });
    }

    log('Starting probe operation:', options);

    const gcodeCommands = generateProbeCode(options);

    if (!gcodeCommands || gcodeCommands.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No G-code generated for probing operation'
      });
    }

    setProbingStatus(true);

    res.json({
      success: true,
      message: 'Probe operation started',
      commandCount: gcodeCommands.length
    });

    (async () => {
      try {
        log('Probe G-code:', gcodeCommands.join('\n'));

        for (const command of gcodeCommands) {
          const cleanCommand = command.trim();
          if (!cleanCommand) continue;

          const commandId = `probe-${Date.now()}-${Math.random().toString(16).slice(2)}`;

          await cncController.sendCommand(cleanCommand, {
            commandId,
            displayCommand: cleanCommand,
            meta: {
              sourceId: 'probing',
              probeOperation: options.probingAxis
            }
          });
        }
      } catch (error) {
        log('Error executing probe G-code:', error);
      } finally {
        setProbingStatus(false);
      }
    })().catch((error) => {
      log('Unhandled probe execution error:', error);
      setProbingStatus(false);
    });
  });

  /**
   * Stop/abort probing operation
   * POST /api/probe/stop
   */
  router.post('/stop', async (_req, res) => {
    try {
      log('Stopping probe operation');

      // Send soft reset to stop any active motion
      await cncController.sendCommand('\x18', {
        meta: { probeControl: true, sourceId: 'client' }
      });

      // Reset probing state
      setProbingStatus(false);

      log('Probe operation stopped (soft reset sent)');

      res.json({
        success: true,
        message: 'Probe operation stopped'
      });
    } catch (error) {
      log('Error stopping probe:', error);
      setProbingStatus(false);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
}
