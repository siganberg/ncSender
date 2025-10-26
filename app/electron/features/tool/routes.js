import { Router } from 'express';

export function createToolRoutes(cncController, serverState, commandProcessor) {
  const router = Router();

  // All tool change and TLS functionality is now handled in websocket.js
  // No API endpoints needed

  return router;
}
