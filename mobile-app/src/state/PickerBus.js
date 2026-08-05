/**
 * PickerBus — hand a callback to a picker screen without putting a function in
 * navigation params (non-serialisable params break state persistence and log
 * warnings). The caller registers a callback, passes the returned token as a
 * param, and the picker resolves it on selection.
 */
let seq = 0;
const callbacks = new Map();

export const PickerBus = {
  /**
   * @param {(result:any) => void} cb
   * @returns {string} token to pass in navigation params
   */
  register(cb) {
    const token = `pick_${++seq}`;
    callbacks.set(token, cb);
    return token;
  },

  /** Fire and forget — a token is single-use. */
  resolve(token, result) {
    const cb = callbacks.get(token);
    callbacks.delete(token);
    cb?.(result);
  },

  /** Drop without firing (picker dismissed). */
  cancel(token) {
    callbacks.delete(token);
  },
};
