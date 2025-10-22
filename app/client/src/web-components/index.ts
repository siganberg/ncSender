import { registerStepControl } from './nc-step-control';
import { registerJogControl } from './nc-jog-control';

export function registerWebComponents() {
  registerStepControl();
  registerJogControl();
}
