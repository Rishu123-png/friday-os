/* FRIDAY OS — P1 split: Chat Controller
   Extracts handleInput chain, pendingDanger, pendingClarify logic
   TODO: move 2000+ lines of brain.js routing here
*/
export function createChatController({ handleInput, state, CLARIFY, PROACTIVE, S }={}) {
  function handleDangerConfirm(text, opts={}) {
    if (state && state.pendingDanger && !opts.noChain) {
      const pending = state.pendingDanger;
      const stale = pending.at && (Date.now()-pending.at>90000);
      state.pendingDanger=null;
      if (stale) return null;
      // ... real confirm logic lives in app.js, this is scaffold
      return pending;
    }
    return null;
  }
  return { handleDangerConfirm };
}
