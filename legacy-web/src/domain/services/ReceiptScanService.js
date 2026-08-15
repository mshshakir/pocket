/**
 * ReceiptScanService — Gemini AI receipt scanning, encapsulated as a domain service.
 *
 * Responsibilities:
 *  - Build a structured prompt that injects real category IDs so the model never
 *    returns names that require fuzzy matching.
 *  - Call the Gemini 2.0 Flash REST endpoint with correct field names, part order,
 *    and generation config.
 *  - Parse and sanitise the response, validating every returned category ID against
 *    the real data set.
 *  - Return a fully-formed `prefill` object ready to pass to the transaction modal,
 *    including `payee`, `date`, `currency`, `note`, `accountId`, `paymentType`, and
 *    `splits` with per-split `accountId`.
 *
 * The caller (app.js) is responsible only for UI concerns: showing toast messages,
 * updating button labels, and opening the modal with the returned prefill.
 *
 * OOP notes:
 *  - All state is held in private fields.
 *  - Public surface is a single async `scan(file)` method.
 *  - Separate private methods for each logical step (base64, prompt, fetch, parse).
 */
import { Store }          from '../../core/Store.js';
import { CurrencyService } from './CurrencyService.js';
import { DateService }     from './DateService.js';

// gemini-2.0-flash and 2.0-flash-lite were deprecated and shut down (June 2026).
// gemini-2.5-flash-lite is the lowest-cost current model with image (vision) input.
const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export class ReceiptScanService {
  /** @type {Store} */           #store;
  /** @type {CurrencyService} */ #fx;

  constructor() {
    this.#store = Store.getInstance();
    this.#fx    = new CurrencyService();
  }

  // ── Public API ────────────────────────────────────────────────────────

  /**
   * Scan a receipt image/PDF with Gemini.
   *
   * @param {File} file  Image or PDF selected by the user.
   * @returns {Promise<Object>} Resolves with a prefill object ready to pass
   *   directly to `openModal('transaction', { prefill })`.
   *   Fields: type, amount (major units), currency, accountId, payee, note,
   *           date (YYYY-MM-DD), paymentType, and optionally categoryId or splits.
   * @throws {Error} With a human-readable `.message` on any failure, including
   *   the sentinel `'NO_API_KEY'` when no Gemini key is configured.
   */
  async scan(file) {
    const state   = this.#store.getState();
    const apiKey  = state.user.geminiApiKey?.trim();
    if (!apiKey) throw new Error('NO_API_KEY');

    // ── Step 1: read file as base64 ──────────────────────────────────
    let base64, mediaType;
    try {
      base64    = await this.#fileToBase64(file);
      mediaType = file.type || 'image/jpeg';
    } catch (_) {
      throw new Error('Could not read the image file. Please try a different file.');
    }

    // ── Step 2: build prompt ─────────────────────────────────────────
    const cats          = state.categories;
    const catLines      = this.#buildCategoryLines(cats);
    const fallback      = cats.find((c) => c.type === 'expense' && !c.parentId) || cats[0];
    const fallbackId    = fallback?.id   || '';
    const fallbackName  = fallback?.name || 'General';
    const today         = DateService.todayIso();
    const defaultCcy    = state.user.defaultCurrency || state.user.homeCurrency || 'USD';
    const prompt        = this.#buildPrompt(defaultCcy, catLines, fallbackId, fallbackName, today);

    // ── Step 3: call Gemini ──────────────────────────────────────────
    // Pass the key via the request header, NOT the URL query string: URLs leak
    // into proxy/browser history and Referer headers far more readily than
    // headers do, and this is the user's personal API key.
    let res;
    try {
      res = await fetch(GEMINI_ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body:    JSON.stringify({
          contents: [{
            parts: [
              // Image FIRST — consistent with Google's own multimodal examples
              { inline_data: { mime_type: mediaType, data: base64 } },
              { text: prompt },
            ],
          }],
          generationConfig: {
            temperature:    0.1,   // low temperature → deterministic, follows format exactly
            maxOutputTokens: 1024,
          },
        }),
      });
    } catch (networkErr) {
      throw new Error('Network error — check your connection and try again.');
    }

    // ── Step 4: check HTTP status ────────────────────────────────────
    if (!res.ok) {
      let msg = `API error ${res.status}`;
      try {
        const errBody = await res.json();
        msg = errBody.error?.message || msg;
      } catch (_) {}
      throw new Error(msg);
    }

    // ── Step 5: parse response ───────────────────────────────────────
    const body = await res.json();
    const raw  = (body.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();

    // Extract the first complete JSON object — handles markdown fences,
    // preamble text, or any other model noise around the JSON.
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in AI response. The model may have refused the request or returned an unexpected format.');
    }

    let receipt;
    try {
      receipt = JSON.parse(jsonMatch[0]);
    } catch (_) {
      throw new Error('Could not parse the AI response as JSON. Please try again.');
    }

    // ── Step 6: sanitise and build prefill ───────────────────────────
    return this.#buildPrefill(receipt, cats, defaultCcy, today, this.#defaultAccountId(state));
  }

  /**
   * Parse a spoken transaction from an audio clip with Gemini.
   * Same endpoint/model/key as receipt scan, but the audio is a person
   * describing ONE spending event ("spent 40 dirhams on groceries at Carrefour
   * yesterday"). Returns the same prefill shape as scan(), INCLUDING `splits`
   * when the speaker described several amounts falling under different
   * categories ("sixty on groceries and forty on petrol").
   *
   * @param {File|Blob|{base64:string, mimeType:string}} audio
   * @returns {Promise<Object>} prefill for openModal('transaction', { prefill })
   * @throws {Error} '.message' human-readable; sentinel 'NO_API_KEY'.
   */
  async parseVoice(audio) {
    const state  = this.#store.getState();
    const apiKey = state.user.geminiApiKey?.trim();
    if (!apiKey) throw new Error('NO_API_KEY');

    let base64, mediaType;
    try {
      if (audio && typeof audio === 'object' && typeof audio.base64 === 'string') {
        base64 = audio.base64; mediaType = audio.mimeType || 'audio/webm';
      } else {
        base64 = await this.#fileToBase64(audio); mediaType = audio.type || 'audio/webm';
      }
    } catch (_) {
      throw new Error('Could not read the recording. Please try again.');
    }

    const cats       = state.categories;
    const catLines   = this.#buildCategoryLines(cats);
    const today      = DateService.todayIso();
    const defaultCcy = state.user.defaultCurrency || state.user.homeCurrency || 'USD';
    const prompt     = this.#buildVoicePrompt(defaultCcy, catLines, today);

    let res;
    try {
      res = await fetch(GEMINI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: mediaType, data: base64 } },
            { text: prompt },
          ] }],
          // 512 was enough for a single flat object; an itemised response with
          // several categories needs the same headroom the receipt path has.
          generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
        }),
      });
    } catch (_) {
      throw new Error('Network error — check your connection and try again.');
    }
    if (!res.ok) {
      let msg = `API error ${res.status}`;
      try { msg = (await res.json()).error?.message || msg; } catch (_) {}
      throw new Error(msg);
    }

    const body = await res.json();
    const raw  = (body.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    const m    = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("Couldn't understand that — try again, e.g. “spent 40 on groceries at Carrefour”.");
    let obj;
    try { obj = JSON.parse(m[0]); } catch (_) { throw new Error('Could not parse the AI response. Please try again.'); }

    return this.#buildVoicePrefill(obj, cats, defaultCcy, today, this.#defaultAccountId(state));
  }

  /** Prompt for a single spoken transaction. */
  #buildVoicePrompt(defaultCurrency, catLines, today) {
    return `You are a personal-finance voice parser. The attached audio is a person describing ONE spending event out loud — which may cover SEVERAL things bought at once. Transcribe it, then return ONLY a single valid JSON object — no markdown, no code fences, no explanation.

REQUIRED JSON SHAPE:
{
  "type": "expense" | "income" | "transfer",
  "total": 0.00,
  "currency": "${defaultCurrency}",
  "date": "YYYY-MM-DD",
  "payee": "merchant, person, or source (may be empty)",
  "note": "short verbatim-ish description of what was said",
  "items": [
    { "description": "what this part of the spend was", "amount": 0.00, "categoryId": "EXACT_ID_FROM_LIST or empty string" }
  ]
}

CATEGORY ID LIST — set each item's categoryId to one of these exact ID strings (copy character-for-character) or "" if none fits:
${catLines}

RULES:
1. "type": default to "expense"; "income" for money received (salary, refund, got paid); "transfer" only if clearly moving between own accounts.
2. "items": ONE entry per separately-priced thing the speaker mentioned.
   - If only one thing is described, return exactly ONE item carrying the whole amount.
   - Group things that share the same best-fit categoryId into a SINGLE item, summing their amounts.
   - Return several items ONLY when the speaker gave separate amounts, e.g. "sixty on groceries and forty on petrol" → two items.
   - Never invent an amount to split a total the speaker gave as one figure.
3. "total": the sum of every item amount. If the speaker also said an overall total, it must agree with that sum.
4. Amounts are in major units, no currency symbols.
5. "currency": detect from words like "dollars", "dirhams" (AED), "rupees" (INR), "pounds" (GBP), "euros" (EUR); else "${defaultCurrency}". Always an ISO 4217 code.
6. "date": resolve relative dates ("today", "yesterday", "last Friday") against TODAY=${today}. Use ${today} if unspecified. Format YYYY-MM-DD.
7. "categoryId": pick the best match for expenses/income; "" if unclear, and always "" for a transfer.
8. If you cannot make out any amount, set "total" to 0 and "items" to [].`;
  }

  /**
   * Validate a parsed voice transaction into a prefill.
   *
   * A single spoken sentence can cover several categories ("sixty on groceries
   * and forty on petrol"). When it does, this returns `splits` in the same
   * shape the receipt scanner produces — TransactionModal already seeds and
   * auto-enables its split editor from that key, so no UI change is needed.
   *
   * Splitting only happens when the items genuinely differ by category: two
   * items that both resolve to Groceries are one line, not a split of one
   * category against itself.
   */
  #buildVoicePrefill(obj, cats, defaultCcy, today, defaultAccId) {
    const validCatIds = new Set(cats.map((c) => c.id));
    const type     = ['expense', 'income', 'transfer'].includes(obj.type) ? obj.type : 'expense';
    const currency = (obj.currency || defaultCcy).toUpperCase();
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    const date     = (obj.date && ISO_DATE.test(obj.date)) ? obj.date : today;

    // Accept the older single-transaction shape too, so a model that ignores
    // the items[] instruction still produces a usable entry.
    const rawItems = Array.isArray(obj.items) && obj.items.length
      ? obj.items
      : [{ amount: obj.total ?? obj.amount, categoryId: obj.categoryId }];

    // Drop hallucinated ids before they can reach the ledger, and never carry a
    // category on a transfer.
    const items = rawItems
      .map((it) => ({
        amount:     Number(it?.amount) || 0,
        categoryId: (type !== 'transfer' && validCatIds.has(it?.categoryId)) ? it.categoryId : '',
      }))
      .filter((it) => it.amount > 0);

    const statedTotal = Number(obj.total ?? obj.amount) || 0;
    const prefill = {
      type,
      currency,
      accountId:   defaultAccId || '',
      payee:       (obj.payee || '').toString().slice(0, 120),
      note:        (obj.note  || 'Voice entry').toString().slice(0, 300),
      date,
      paymentType: this.#defaultPaymentType(),
      categoryId:  '',
      amount:      statedTotal,   // major units — the modal converts
    };

    if (!items.length) return prefill;

    const distinctCats = new Set(items.map((it) => it.categoryId));
    const shouldSplit  = type !== 'transfer' && items.length > 1 && distinctCats.size > 1;

    if (!shouldSplit) {
      const sum = items.reduce((s, it) => s + it.amount, 0);
      prefill.amount     = statedTotal > 0 ? statedTotal : sum;
      prefill.categoryId = items.find((it) => it.categoryId)?.categoryId || '';
      return prefill;
    }

    const { splits, total } = this.#reconcileSplits(items, currency, statedTotal, defaultAccId);
    prefill.splits     = splits;
    prefill.amount     = total;
    prefill.categoryId = '';
    return prefill;
  }

  /**
   * Turn parsed line items into split legs whose minor-unit amounts sum to the
   * parent EXACTLY.
   *
   * submitTx refuses to save when they disagree by even one minor unit
   * ("Splits must add up to …"), and both a spoken total and per-item rounding
   * can drift. Rather than hand the user a pre-filled form that cannot be
   * saved, the residue is absorbed by the largest leg — proportionally the
   * least distorting place to put a sub-unit difference.
   *
   * @param {{amount: number, categoryId: string}[]} items  amounts in MAJOR units
   * @param {string} currency
   * @param {number} statedTotal  the total the model reported, MAJOR units
   * @param {string} defaultAccId
   * @returns {{splits: object[], total: number}}  total in MAJOR units
   */
  #reconcileSplits(items, currency, statedTotal, defaultAccId) {
    const legs = items.map((it) => ({
      categoryId: it.categoryId || null,
      accountId:  defaultAccId || '',
      // Splits are stored in MINOR units, unlike prefill.amount.
      amount:     this.#fx.toMinor(it.amount, currency),
    })).filter((l) => l.amount > 0);

    const legSum      = legs.reduce((s, l) => s + l.amount, 0);
    const statedMinor = this.#fx.toMinor(statedTotal, currency);
    // Trust a stated total only when it is within a rounding hair of the parts.
    // A mis-heard total ("forty" for "fourteen") must not silently inflate the
    // transaction — the itemised amounts are the more reliable signal.
    const tolerance   = Math.max(2, Math.round(legSum * 0.02));
    let   target      = (statedMinor > 0 && Math.abs(statedMinor - legSum) <= tolerance)
      ? statedMinor : legSum;

    const residue = target - legSum;
    if (residue !== 0) {
      let big = 0;
      legs.forEach((l, i) => { if (l.amount > legs[big].amount) big = i; });
      // Never let the adjustment zero out or invert a leg; fall back to the
      // itemised sum instead, which is always internally consistent.
      if (legs[big].amount + residue > 0) legs[big].amount += residue;
      else target = legSum;
    }

    return { splits: legs, total: this.#fx.fromMinor(target, currency) };
  }

  // ── Private helpers ───────────────────────────────────────────────────

  /**
   * Convert a File to a base64-encoded data string (without the data-URL prefix).
   * @param {File} file
   * @returns {Promise<string>}
   */
  #fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader  = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * Build the category list injected into the prompt.
   * Each line shows the exact database ID the model must copy verbatim,
   * plus the human name and type for context.
   * Subcategories are indented and show "Parent > Child" so the model
   * can pick the most specific match.
   *
   * @param {object[]} cats  Full category array from state.
   * @returns {string}
   */
  /**
   * The account a scan/voice prefill should target.
   *
   * Honours the Settings preference, but resolves through AccountService so a
   * preference naming a deleted or archived account still yields a usable id.
   * @param {object} state
   * @returns {string|undefined}
   */
  #defaultAccountId(state) {
    return window.__app?.accountService?.defaultId?.() ?? state.accounts[0]?.id;
  }

  /** @returns {string} the Settings default payment method */
  #defaultPaymentType() {
    return window.__app?.paymentTypeService?.defaultType?.() || 'card';
  }

  #buildCategoryLines(cats) {
    return cats.map((c) => {
      if (c.parentId) {
        const parent = cats.find((p) => p.id === c.parentId);
        return `  ID="${c.id}"  →  ${parent ? parent.name + ' > ' : ''}${c.name}  [${c.type}]`;
      }
      return `ID="${c.id}"  →  ${c.name}  [${c.type}]`;
    }).join('\n');
  }

  /**
   * Build the complete Gemini prompt string.
   * The prompt instructs the model to return a single JSON object (not an array)
   * with strict schema, using exact category IDs from the injected list.
   */
  #buildPrompt(defaultCurrency, catLines, fallbackId, fallbackName, today) {
    return `You are a receipt parser. Analyze the attached receipt and return ONLY a single valid JSON object. No markdown, no code fences, no explanation — just the raw JSON.

REQUIRED JSON SHAPE:
{
  "merchant": "store or merchant name",
  "date": "YYYY-MM-DD",
  "total": 0.00,
  "currency": "${defaultCurrency}",
  "note": "one-line description of the purchase",
  "items": [
    { "description": "item label", "qty": "1x", "amount": 0.00, "categoryId": "EXACT_ID_FROM_LIST" }
  ]
}

CATEGORY ID LIST — you MUST set categoryId to one of these exact ID strings. Copy the ID character-for-character. Do NOT invent IDs, do NOT use the category name as the ID:
${catLines}

FALLBACK: if an item does not match any category well, use ID="${fallbackId}" (${fallbackName}).

RULES:
1. Each item must have a categoryId from the list above — no exceptions.
2. Group line items sharing the same best-fit category into one, summing their amounts.
3. If the whole receipt is one category, return a single item with the full total.
4. "total" must equal the sum of all item amounts.
5. Date → YYYY-MM-DD. Use ${today} if the date is not legible on the receipt.
6. Currency → detect from any symbol/code on the receipt; if absent use "${defaultCurrency}". Always return an ISO 4217 code.
7. "qty" → full unit detail exactly as printed (count, weight, volume, size, pack). Use "1x" only if no unit info is shown.`;
  }

  /**
   * Validate the parsed receipt object and produce a fully-formed prefill.
   *
   * @param {object}   receipt       Parsed JSON from Gemini
   * @param {object[]} cats          Category array from state
   * @param {string}   defaultCcy    Fallback currency code
   * @param {string}   today         ISO date string
   * @param {string}   defaultAccId  First account ID (default for splits)
   * @returns {Object} prefill object
   */
  #buildPrefill(receipt, cats, defaultCcy, today, defaultAccId) {
    const validCatIds   = new Set(cats.map((c) => c.id));
    const currency      = (receipt.currency || defaultCcy).toUpperCase();

    // Normalise items array — fall back to a single "whole receipt" item if missing
    const rawItems = Array.isArray(receipt.items) && receipt.items.length > 0
      ? receipt.items
      : [{ description: receipt.note || 'Receipt', amount: receipt.total || 0, categoryId: '' }];

    // Validate every categoryId — clear any ID the model invented
    const items = rawItems.map((item) => ({
      ...item,
      categoryId: validCatIds.has(item.categoryId) ? item.categoryId : '',
    }));

    // Compute total (prefer receipt-level total; fall back to sum of items)
    const total = Number(receipt.total) || items.reduce((s, i) => s + (Number(i.amount) || 0), 0);

    // Build a human-readable note: one line per item with qty and amount
    const itemNote = items
      .map((item) => {
        const qty = item.qty || '1x';
        return `${item.description}: ${qty} · ${currency} ${Number(item.amount || 0).toFixed(2)}`;
      })
      .join('\n');

    // Validate date format — Gemini may return natural language or wrong format
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    const date = (receipt.date && ISO_DATE.test(receipt.date)) ? receipt.date : today;

    const prefill = {
      type:        'expense',
      amount:      total,            // major units — the modal converts via toMinor
      currency,
      accountId:   defaultAccId || '',
      payee:       receipt.merchant || '',
      note:        itemNote || receipt.note || 'Scanned from receipt',
      date,
      paymentType: this.#defaultPaymentType(),
    };

    if (items.length > 1) {
      // Multiple categories → pre-populate splits, each with an accountId
      prefill.splits = items.map((item) => ({
        categoryId: item.categoryId || null,
        accountId:  defaultAccId || '',
        // Splits expect minor units; convert from the major-unit amount Gemini returns
        amount: this.#fx.toMinor(Number(item.amount) || 0, currency),
      }));
      prefill.categoryId = '';
    } else {
      // Single category → populate categoryId on the main form
      prefill.categoryId = items[0]?.categoryId || '';
    }

    return prefill;
  }
}
