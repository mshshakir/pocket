/**
 * ImportPrompt — what Import with AI sends to the AI. Only the column names,
 * a few sample rows and the values used most in each text column leave the
 * device; Pocket itself reads every row.
 *
 *   first(tables, book)                       → read the file, write the rules
 *   change(tables, book, mapping, draft, msg) → the person typed a correction
 */
export class ImportPrompt {
  static MAX_CHARS = 18000;
  static #SAMPLES = 8;
  static #VALUES = 40;

  static first(tables, book) {
    return ImportPrompt.#fit((samples, values) => `${ImportPrompt.#rules()}

${ImportPrompt.#book(book)}

${ImportPrompt.#tables(tables, samples, values)}

Reply with ONLY the JSON plan.`);
  }

  static change(tables, book, mapping, draft, message) {
    const counts = draft.counts;
    const plain = { ...mapping };
    delete plain.reply;
    const loose = draft.uncategorisedTop(25).map(([k, n]) => `${k} (${n})`).join('; ');
    return ImportPrompt.#fit((samples, values) => `${ImportPrompt.#rules()}

${ImportPrompt.#book(book)}

${ImportPrompt.#tables(tables, samples, values)}

CURRENT PLAN:
${JSON.stringify(plain)}

PREVIEW WITH THIS PLAN: ${counts.expenses} expenses, ${counts.incomes} incomes, ${counts.transfers} transfers, ${counts.budgets} budgets, ${counts.attention} rows to check, ${counts.uncategorised} entries with no category.
New accounts: ${draft.accounts.filter((a) => !a.existing).map((a) => a.name).join(', ') || 'none'}.
${loose ? `Most used details with no category: ${loose}` : ''}

THE PERSON SAYS: ${String(message).slice(0, 600)}

Change the plan to do what they ask, keeping everything else. Reply with ONLY the whole updated JSON plan; in "reply", say in one or two short plain sentences what you changed (or why you couldn't).`);
  }

  static #rules() {
    return `You read a money spreadsheet for Pocket, a personal money app, and write a JSON plan that Pocket's code applies to every row. Never invent rows or amounts.
Each TABLE below is one block of the file. Decide what each is:
- "entries": expenses and/or incomes (may include transfers);
- "transfers": money moved between the person's own accounts (from / to);
- "budgets": spending limits by category (no dates);
- "skip": summaries, notes, totals, anything else.
If a table has no header row of its own and its "columns" look like data matching an earlier table, set "sameAs" to that table's id (its columns are used).

JSON plan shape (use the EXACT column names given; leave out what doesn't exist):
{"reply":"one short sentence for the person",
 "tables":[{"id":"t1","kind":"entries","why":"short reason",
   "columns":{"date":"","amount":"","debit":"","credit":"","type":"","category":"","subcategory":"","account":"","to":"","payee":"","note":"","currency":"","period":""},
   "types":{"expense":["values of the type column meaning money out"],"income":["…money in"],"transfer":["…between own accounts"]},
   "sign":"negative_expense | negative_income (only when there is no type column and amounts carry a sign)",
   "fixed":"expense | income (only when every row is one kind)",
   "dateOrder":"DMY | MDY | YMD","account":"account name to use when there is no account column","period":"month | week | year (budgets)"}],
 "categories":{"<a value of the category column, exactly as written>":["Pocket main category","Pocket subcategory or empty"]},
 "accounts":{"<account value from the file>":"<account name to use>"},
 "rules":[{"contains":"lowercase word in the details","category":["Main","Sub"]}]}

Guidance:
- "debit"/"credit": two amount columns (money out / money in) instead of one.
- Types: copy the values from the type column exactly (e.g. "Dr", "Cr", "Expense").
- Dates: pick dateOrder from the sample dates (e.g. 13/11/2025 means DMY).
- Categories: map EVERY value listed for the category column (and "Category › Subcategory" pairs if you need them to differ). Prefer the person's existing Pocket categories (same meaning, not just same word); otherwise keep the file's own name as a new main category.
- When a table has no category column, write "rules" for the most common details/payees you can place with confidence.
- Accounts: map a file account to an existing Pocket account only when it is clearly the same one (e.g. "HDFC" → "HDFC Bank"); otherwise keep the file's name.
- "payee" is who was paid or paid you; "note" is any other description. A single "Details"/"Description" column is usually "payee".
- Never use the words mutual funds, stock market or index; say "shares".`;
  }

  static #book(book) {
    const cats = book.categories || [];
    const mains = cats.filter((c) => !c.parentId);
    const lines = mains.slice(0, 60).map((m) => {
      const subs = cats.filter((c) => c.parentId === m.id).map((c) => c.name).slice(0, 25);
      return `${m.name} (${m.type === 'income' ? 'income' : 'spending'})${subs.length ? `: ${subs.join(', ')}` : ''}`;
    });
    const accounts = (book.accounts || []).filter((a) => !a.archived).map((a) => a.name).slice(0, 40);
    return `POCKET CATEGORIES:\n${lines.join('\n') || '(none yet)'}\n\nPOCKET ACCOUNTS: ${accounts.join(', ') || '(none yet)'}`;
  }

  static #tables(tables, samples, values) {
    return tables.map((t) => {
      const rows = t.rows;
      const pick = rows.length <= samples ? rows
        : [...rows.slice(0, Math.ceil(samples / 2)), ...rows.slice(Math.floor(rows.length / 2), Math.floor(rows.length / 2) + Math.floor(samples / 2))];
      const head = `TABLE ${t.id} · sheet "${t.sheet}" rows ${t.firstRow}–${t.lastRow} · ${rows.length} data rows${t.title ? ` · title above it: "${t.title}"` : ''}`;
      const cols = `columns: ${t.columns.join(' | ')}`;
      const sample = pick.map((r) => `  ${r.cells.map((c) => String(c).slice(0, 40)).join(' | ')}`).join('\n');
      const skipped = t.skipped.length ? `\nleft out as totals: ${t.skipped.map((s) => s.text).join(', ').slice(0, 200)}` : '';
      return `${head}\n${cols}\nsample rows:\n${sample}${skipped}\n${ImportPrompt.#values(t, values)}`;
    }).join('\n\n');
  }

  /** The most used values of each text column, and the category values to map. */
  static #values(t, limit) {
    const out = [];
    t.columns.forEach((name, i) => {
      const freq = new Map();
      let numeric = 0;
      for (const r of t.rows) {
        const v = String(r.cells[i] ?? '').trim();
        if (!v) continue;
        if (/^[-+(]?[₹$€£]?\s?[\d,.\s]+\)?\s*(dr|cr)?$/i.test(v) || /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(v)) numeric++;
        freq.set(v.slice(0, 40), (freq.get(v.slice(0, 40)) || 0) + 1);
      }
      if (!freq.size || numeric > t.rows.length / 2) return;
      const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
      out.push(`  ${name} (${freq.size} different): ${top.map(([v, n]) => `${v} (${n})`).join('; ')}`);
    });
    return out.length ? `values used most, by column:\n${out.join('\n')}` : '';
  }

  /** Shrinks samples and value lists until the prompt fits. */
  static #fit(build) {
    for (const [s, v] of [[ImportPrompt.#SAMPLES, ImportPrompt.#VALUES], [6, 25], [4, 15], [3, 8], [2, 4]]) {
      const text = build(s, v);
      if (text.length <= ImportPrompt.MAX_CHARS) return text;
    }
    return build(1, 2).slice(0, ImportPrompt.MAX_CHARS);
  }
}
