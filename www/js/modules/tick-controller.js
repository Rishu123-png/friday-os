/* FRIDAY OS — P1 split: Tick + Proactive Controller
   Extracts status clock, proactive assistant, telemetry from app.js
*/
export function createTickController({ $, D, S, U, NAT, VOX, Bus }={}) {
  function startClock() {
    const tick = () => {
      const el = $('#statusTime');
      if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
    tick();
    const id = setInterval(tick, 15000); // P1: 10s -> 15s
    return () => clearInterval(id);
  }
  return { startClock };
}
