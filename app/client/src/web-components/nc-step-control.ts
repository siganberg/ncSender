import { defineCustomElement } from 'vue';
import SmartStepControlVue from './SmartStepControl.vue';

const StepControlElement = defineCustomElement(SmartStepControlVue, {
  shadowRoot: false
});

export function registerStepControl() {
  if (!customElements.get('nc-step-control')) {
    customElements.define('nc-step-control', StepControlElement);
  }
}
