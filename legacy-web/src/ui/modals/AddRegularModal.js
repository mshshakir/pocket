/**
 * AddRegularModal — "What do you want to track?" One question, four answers,
 * each opening the right short form, so nobody has to learn which feature is
 * which:
 *   bill        same amount on a date (rent, subscriptions)  → a repeating entry
 *   billAsk     a bill whose amount changes (electricity)    → a repeating entry that asks
 *   delivery    comes most days, paid monthly (milk, paper)  → a delivery
 *   shortcut    something bought often (coffee, bus fare)    → a shortcut
 */
export class AddRegularModal {
  static CHOICES = Object.freeze([
    { key: 'bill',     icon: 'repeat',   title: 'A bill on a fixed date, same amount', eg: 'Rent, school fees, Netflix' },
    { key: 'billAsk',  icon: 'receipt',  title: 'A bill on a date, the amount changes', eg: 'Electricity, phone, gas' },
    { key: 'delivery', icon: 'truck',    title: 'Delivered most days, paid monthly', eg: 'Milk, newspaper, maid' },
    { key: 'shortcut', icon: 'zap',      title: 'Something I buy often', eg: 'Coffee, bus fare, vegetables' },
  ]);

  render() {
    return `
      <div class="p-5" style="min-width:300px;max-width:460px">
        <div class="flex items-center justify-between mb-1">
          <h3 class="text-lg font-semibold">What do you want to track?</h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>
        </div>
        <p class="text-xs text-zinc-500 mb-4">Pick the one that sounds like it — you can change it later.</p>
        <div class="grid gap-2">
          ${AddRegularModal.CHOICES.map((c) => `
            <button type="button" class="add-choice" onclick="window.__app.startRegular('${c.key}')">
              <span class="icon-pill"><i data-lucide="${c.icon}"></i></span>
              <span class="text-left"><b>${c.title}</b><small>${c.eg}</small></span>
              <i data-lucide="chevron-right" class="ml-auto text-zinc-400"></i>
            </button>`).join('')}
        </div>
      </div>`;
  }
}
