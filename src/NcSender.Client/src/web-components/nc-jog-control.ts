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
