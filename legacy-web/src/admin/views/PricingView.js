/**
 * PricingView — plan prices, billing settings (payments on/off, grace period,
 * AI price and pack, credit validity) and offers (sales and coupon codes).
 * Every change is written to the audit log.
 */
import { AdminView } from './AdminView.js';
import { Format } from '../Format.js';

export class PricingView extends AdminView {
  static PRODUCTS = ['sync_month', 'sync_year', 'family_trial', 'family_month', 'family_year', 'ai_pack', 'programme'];

  #data = null;

  get title() { return 'Pricing & offers'; }

  async load() { this.#data = await this.api.pricing(); }

  html() {
    if (!this.#data) return '<p class="muted">Loading…</p>';
    return `${this.#settings()}${this.#plans()}${this.#offers()}${this.#newOffer()}`;
  }

  #settings() {
    const s = this.#data.settings;
    return `
      <div class="panel">
        <h3>Settings</h3>
        <form data-form="settings" class="form-grid">
          <label class="check wide"><input type="checkbox" name="payments_enabled" ${s.payments_enabled ? 'checked' : ''}> <b>Online payment on</b> <span class="muted">(buy buttons in the app and the programme page)</span></label>
          <label>Read-only days after a plan ends<input name="grace_days" type="number" min="0" class="input" value="${s.grace_days}"></label>
          <label>AI price per credit (₹)<input name="ai_credit" class="input" value="${Format.rupees(s.ai_credit_paise)}"></label>
          <label>AI pack price (₹)<input name="ai_pack" class="input" value="${Format.rupees(s.ai_pack_paise)}"></label>
          <label>AI credits valid for (days)<input name="ai_credit_days" type="number" min="1" class="input" value="${s.ai_credit_days}"></label>
          <div class="wide"><button class="btn">Save settings</button></div>
        </form>
      </div>`;
  }

  #plans() {
    const rows = this.#data.plans.filter((p) => p.code !== 'free').map((p) => `
      <tr>
        <td colspan="8">
          <form data-form="plan" data-code="${Format.esc(p.code)}" class="plan-row">
            <span class="strong code">${Format.esc(p.code)}</span>
            <label>Name<input name="name" class="input" value="${Format.esc(p.name)}"></label>
            <label>Month ₹<input name="monthly" class="input" value="${Format.rupees(p.monthly_paise)}" placeholder="not sold"></label>
            <label>Year ₹<input name="yearly" class="input" value="${Format.rupees(p.yearly_paise)}" placeholder="not sold"></label>
            <label>Trial ₹<input name="trial" class="input" value="${Format.rupees(p.trial_paise)}" placeholder="none"></label>
            <label>Trial days<input name="trial_days" type="number" min="1" class="input" value="${p.trial_days ?? ''}"></label>
            <label>People<input name="seats" type="number" min="1" class="input" value="${p.seats}"></label>
            <label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> On sale</label>
            <button class="btn">Save</button>
          </form>
        </td>
      </tr>`).join('');
    return `
      <div class="panel">
        <h3>Plans</h3>
        <p class="muted small">A new price applies to purchases from now on; nobody's current plan changes. Leave a price empty to stop selling that term.</p>
        <table class="table"><tbody>${rows}</tbody></table>
      </div>`;
  }

  #offers() {
    const now = Date.now();
    const rows = this.#data.offers.map((o) => {
      const ended = o.ends_at && new Date(o.ends_at).getTime() <= now;
      const future = new Date(o.starts_at).getTime() > now;
      const used = o.max_uses && o.uses >= o.max_uses;
      const state = !o.active ? Format.pill('off') : ended ? Format.pill('ended') : future ? Format.pill('starts later', 'warn') : used ? Format.pill('used up') : Format.pill('running', 'good');
      const what = o.percent_off ? `${o.percent_off}% off` : o.amount_off_paise ? `${Format.inr(o.amount_off_paise)} off` : `price ${Format.inr(o.sale_price_paise)}`;
      return `
        <tr>
          <td>${o.kind === 'coupon' ? Format.pill(o.code, 'accent') : Format.pill('sale')}<div class="sub">${Format.esc(o.name)}</div>
            <div class="row-actions">
              <button data-action="offer-active" data-id="${o.id}" data-on="${!o.active}" class="btn btn-soft btn-sm">${o.active ? 'Switch off' : 'Switch on'}</button>
              <button data-action="offer-delete" data-id="${o.id}" data-label="${Format.esc(o.kind === 'coupon' ? `code ${o.code}` : `sale "${o.name}"`)}" data-uses="${o.uses}" class="btn btn-danger btn-sm">Delete</button>
            </div></td>
          <td>${what}</td>
          <td>${o.products?.length ? o.products.map((p) => Format.esc(p)).join(', ') : 'everything'}</td>
          <td>${Format.date(o.starts_at)} – ${o.ends_at ? Format.date(o.ends_at) : 'no end'}</td>
          <td class="num">${o.uses}${o.max_uses ? ` / ${o.max_uses}` : ''}</td>
          <td>${state}</td>
        </tr>`;
    }).join('');
    return `
      <div class="panel">
        <h3>Offers</h3>
        <p class="muted small">A sale changes the price for everyone while it runs. A coupon is a code people type at checkout; it applies after any sale. A use is counted when the payment goes through.</p>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Offer</th><th>Discount</th><th>For</th><th>When</th><th class="num">Used</th><th>State</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" class="muted">No offers yet.</td></tr>'}</tbody>
        </table></div>
      </div>`;
  }

  #newOffer() {
    const boxes = PricingView.PRODUCTS.map((p) => `<label class="check"><input type="checkbox" name="products" value="${p}"> ${p}</label>`).join('');
    return `
      <div class="panel">
        <h3>New offer</h3>
        <form data-form="offer" class="form-grid">
          <label>Kind<select name="kind" class="input"><option value="coupon">Coupon code</option><option value="sale">Sale (for everyone)</option></select></label>
          <label>Code (coupons)<input name="code" class="input" placeholder="e.g. LAUNCH20" maxlength="32"></label>
          <label class="wide">Name (for you)<input name="name" class="input" required placeholder="e.g. Launch week, friends and family"></label>
          <label>Discount<select name="how" class="input">
            <option value="percent">% off</option><option value="amount">₹ off (coupons)</option><option value="price">New price ₹ (sale, one product)</option></select></label>
          <label>Value<input name="value" class="input" required placeholder="e.g. 20"></label>
          <div class="wide"><div class="label">For (none ticked = everything)</div><div class="checks">${boxes}</div></div>
          <label>Starts<input name="starts" type="date" class="input"></label>
          <label>Ends (optional)<input name="ends" type="date" class="input"></label>
          <label>Max uses (optional)<input name="max_uses" type="number" min="1" class="input"></label>
          <div class="wide"><button class="btn">Create offer</button></div>
        </form>
      </div>`;
  }

  async act(action, el, form) {
    switch (action) {
      case 'settings': {
        await this.api.updateSettings({
          payments_enabled: form.get('payments_enabled') === 'on',
          grace_days: Number(AdminView.text(form, 'grace_days')),
          ai_credit_paise: Format.paise(AdminView.text(form, 'ai_credit')),
          ai_pack_paise: Format.paise(AdminView.text(form, 'ai_pack')),
          ai_credit_days: Number(AdminView.text(form, 'ai_credit_days')),
        }).then((d) => { this.#data = d; });
        this.host.toast('Settings saved');
        return true;
      }
      case 'plan': {
        const code = el.dataset.code;
        const days = AdminView.text(form, 'trial_days');
        this.#data = await this.api.updatePlan(code, {
          name: AdminView.text(form, 'name'),
          monthly_paise: Format.paise(AdminView.text(form, 'monthly')),
          yearly_paise: Format.paise(AdminView.text(form, 'yearly')),
          trial_paise: Format.paise(AdminView.text(form, 'trial')),
          trial_days: days ? Number(days) : null,
          seats: Number(AdminView.text(form, 'seats')),
          active: form.get('active') === 'on',
        });
        this.host.toast(`${code} saved`);
        return true;
      }
      case 'offer': {
        const kind = AdminView.text(form, 'kind');
        const how = AdminView.text(form, 'how');
        const value = AdminView.text(form, 'value');
        const products = form.getAll('products').map(String);
        const offer = {
          kind, name: AdminView.text(form, 'name'), products,
          code: kind === 'coupon' ? AdminView.text(form, 'code').toUpperCase() : '',
          starts_at: AdminView.text(form, 'starts') ? `${AdminView.text(form, 'starts')}T00:00:00+05:30` : '',
          ends_at: AdminView.text(form, 'ends') ? `${AdminView.text(form, 'ends')}T23:59:59+05:30` : '',
          max_uses: AdminView.text(form, 'max_uses'),
        };
        if (kind === 'coupon' && !/^[A-Z0-9_-]{3,32}$/.test(offer.code)) throw new Error('A coupon needs a code: 3–32 letters, digits, - or _');
        if (how === 'percent') offer.percent_off = Number(value);
        else if (how === 'amount') {
          if (kind !== 'coupon') throw new Error('"₹ off" is for coupons; use % off or a new price for a sale');
          offer.amount_off_paise = Format.paise(value);
        } else {
          if (kind !== 'sale' || products.length !== 1) throw new Error('A new price is for a sale on exactly one product');
          offer.sale_price_paise = Format.paise(value);
        }
        this.#data = await this.api.saveOffer(offer);
        this.host.toast('Offer created');
        return true;
      }
      case 'offer-active':
        this.#data = await this.api.saveOffer({ id: el.dataset.id, active: el.dataset.on === 'true' });
        this.host.toast(el.dataset.on === 'true' ? 'Offer on' : 'Offer off');
        return true;
      case 'offer-delete': {
        const uses = Number(el.dataset.uses) || 0;
        const ask = `Delete the ${el.dataset.label}?` + (uses
          ? ` It has been used ${uses} time${uses === 1 ? '' : 's'}; those payments keep their price. Switching it off instead keeps it in this list.`
          : ' This can\'t be undone.');
        if (!confirm(ask)) return false;
        this.#data = await this.api.deleteOffer(el.dataset.id);
        this.host.toast('Offer deleted');
        return true;
      }
      default:
        return false;
    }
  }
}
