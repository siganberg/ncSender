import { defineCustomElement } from 'vue';
import SmartJogControlVue from './SmartJogControl.vue';

const JogControlsElement = defineCustomElement(SmartJogControlVue, {
  shadowRoot: false
});

export function registerJogControl() {
  if (!customElements.get('nc-jog-control')) {
    customElements.define('nc-jog-control', JogControlsElement);
  }
}
