/* FRIDAY OS — P1 split: Voice Controller
   Future home for V.initRecognition, wake word, Sherpa voice arming
   Currently re-exports from voice.js with battery-aware guards
*/
import * as V from '../voice.js';
import { Bus } from '../fridaycore.js';
export function createVoiceController(deps={}) {
  // P1: wrapper that ensures bridge ready before init
  async function initVoiceWithBridge() {
    const { waitForBridge, isNative } = await import('../native.js');
    if (isNative()) await waitForBridge(2000);
    return V.initSynthesis ? V.initSynthesis() : { ok: true };
  }
  return { initVoiceWithBridge, V, Bus };
}
