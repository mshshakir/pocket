/**
 * HelpModal — shows a page's short guide (see HelpGuide).
 *
 * opts: { page: string }
 */
import { HelpGuide } from '../components/HelpGuide.js';
import { Html }      from '../../core/Html.js';

export class HelpModal {
  render(opts = {}) {
    const g = HelpGuide.guide(opts.page);
    return `
      <div class="p-5 help-sheet">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-lg font-semibold flex items-center gap-2"><i data-lucide="circle-help"></i> ${Html.escape(g ? g.title : 'Help')}</h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>
        </div>
        ${g ? HelpGuide.body(opts.page) : '<p class="text-sm text-zinc-500">No guide for this page yet.</p>'}
        <div class="flex justify-end mt-5">
          <button type="button" class="btn btn-primary" onclick="window.__app.closeModal()">Got it</button>
        </div>
      </div>`;
  }
}
