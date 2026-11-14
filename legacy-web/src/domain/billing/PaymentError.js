/** A payment step that didn't work, with a sentence for the person. */
export class PaymentError extends Error {
  /**
   * @param {string} message
   * @param {'signed_out'|'closed'|'not_allowed'|'not_set_up'|'bad_signature'|'not_yours'|'failed'|'network'|'dismissed'|'bad_request'} code
   */
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}
