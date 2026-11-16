/**
 * AdminApi — every server call the admin dashboard makes. Each is a database
 * function that refuses anyone who isn't in the admins table (migration 0028),
 * so the page's code being public gives nobody access.
 */
export class AdminApi {
  #session;

  /** @param {import('../web/PocketSession.js').PocketSession} session */
  constructor(session) {
    this.#session = session;
  }

  isAdmin()                  { return this.#session.rpc('pocket_is_admin'); }
  stats()                    { return this.#session.rpc('pocket_adm_stats'); }
  users(search = '', limit = 200, offset = 0) {
    return this.#session.rpc('pocket_adm_users', { p_search: search || null, p_limit: limit, p_offset: offset });
  }
  userAction(email, action, args = {}) {
    return this.#session.rpc('pocket_adm_user_action', { p_email: email, p_action: action, p_args: args });
  }
  payments(limit = 300)      { return this.#session.rpc('pocket_adm_payments', { p_limit: limit }); }
  pricing()                  { return this.#session.rpc('pocket_adm_pricing'); }
  updatePlan(code, patch)    { return this.#session.rpc('pocket_adm_update_plan', { p_code: code, p: patch }); }
  updateSettings(patch)      { return this.#session.rpc('pocket_adm_update_settings', { p: patch }); }
  saveOffer(offer)           { return this.#session.rpc('pocket_adm_save_offer', { p: offer }); }
  deleteOffer(id)            { return this.#session.rpc('pocket_adm_delete_offer', { p_id: Number(id) }); }
  programme()                { return this.#session.rpc('pocket_adm_programme'); }
  saveBatch(batch)           { return this.#session.rpc('pocket_adm_save_batch', { p: batch }); }
  application(id, action, args = {}) {
    return this.#session.rpc('pocket_adm_application', { p_id: id, p_action: action, p_args: args });
  }
  tracker(batchId)           { return this.#session.rpc('pocket_adm_tracker', { p_batch: batchId }); }
  setDay(applicationId, day, recorded) {
    return this.#session.rpc('pocket_adm_set_day', { p_application: applicationId, p_day: day, p_recorded: recorded });
  }
  saveCall(call)             { return this.#session.rpc('pocket_adm_save_call', { p: call }); }
  audit(limit = 300)         { return this.#session.rpc('pocket_adm_audit', { p_limit: limit }); }
  feedback(status = null, limit = 300) { return this.#session.rpc('pocket_adm_feedback', { p_status: status, p_limit: limit }); }
  freeRequests(status = null, limit = 300) { return this.#session.rpc('pocket_adm_free_requests', { p_status: status, p_limit: limit }); }
  setFreeRequest(id, status, note = null) { return this.#session.rpc('pocket_adm_free_request_set', { p_id: Number(id), p_status: status, p_note: note }); }
  setFeedback(id, status, note = null) { return this.#session.rpc('pocket_adm_feedback_set', { p_id: Number(id), p_status: status, p_note: note }); }
}
