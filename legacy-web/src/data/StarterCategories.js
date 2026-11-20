/**
 * StarterCategories — the ready-made category list a new book is set up from
 * (owner, 20 Nov 2026).
 *
 * Main categories each carry a few common subcategories. Every entry needs a
 * subcategory, so a main is never offered on its own. `when` names the setup
 * answers that tick a main (BookSetupModal): `always`, or one of the life
 * chips / income chips. Unticked mains are simply left out; nothing stops the
 * person adding them later.
 */
export class StarterCategories {
  /** Life chips asked in setup: [key, label]. */
  static LIFE = Object.freeze([
    ['rent', 'Rent'],
    ['ownhome', 'Own home'],
    ['children', 'Children / school'],
    ['vehicle', 'Car or bike'],
    ['parents', 'Support parents'],
    ['business', 'Run a business'],
    ['giving', 'Giving / charity'],
    ['travel', 'Travel'],
    ['pets', 'Pets'],
    ['fitness', 'Gym / sports'],
  ]);

  /** Income chips: [key, label]. */
  static INCOME = Object.freeze([
    ['salary', 'Salary'],
    ['business', 'Business'],
    ['rentin', 'Rent received'],
    ['family', 'From family'],
    ['investments', 'Investments'],
  ]);

  /** The list. `when`: which answers tick it (any of them). */
  static LIST = Object.freeze([
    { key: 'food', name: 'Food', type: 'expense', icon: 'utensils', color: '#f97316', when: ['always'],
      subs: ['Groceries', 'Vegetables & fruit', 'Milk', 'Eating out'] },
    { key: 'home', name: 'Home', type: 'expense', icon: 'home', color: '#a16207', when: ['always'],
      subs: ['Electricity', 'Gas', 'Water', 'Household items', 'Maintenance'], extra: { rent: 'Rent', ownhome: 'Home loan EMI' } },
    { key: 'transport', name: 'Transport', type: 'expense', icon: 'bus', color: '#3b82f6', when: ['always'],
      subs: ['Auto / taxi', 'Train / bus', 'Fuel', 'Parking'] },
    { key: 'vehicle', name: 'Vehicle', type: 'expense', icon: 'car', color: '#2563eb', when: ['vehicle'],
      subs: ['Service', 'Insurance', 'EMI'] },
    { key: 'health', name: 'Health', type: 'expense', icon: 'heart-pulse', color: '#ef4444', when: ['always'],
      subs: ['Doctor', 'Medicines', 'Tests', 'Insurance'] },
    { key: 'education', name: 'Education', type: 'expense', icon: 'graduation-cap', color: '#10b981', when: ['children'],
      subs: ['School fees', 'Tuition', 'Books & stationery'] },
    { key: 'family', name: 'Family', type: 'expense', icon: 'users', color: '#fb7185', when: ['children', 'parents'],
      subs: ['Children', 'Parents', 'Gifts'] },
    { key: 'personal', name: 'Personal', type: 'expense', icon: 'user-round', color: '#8b5cf6', when: ['always'],
      subs: ['Clothes', 'Grooming', 'Mobile & internet'] },
    { key: 'shopping', name: 'Shopping', type: 'expense', icon: 'shopping-bag', color: '#ec4899', when: ['always'],
      subs: ['Electronics', 'Home goods', 'Online'] },
    { key: 'giving', name: 'Giving', type: 'expense', icon: 'hand-heart', color: '#d946ef', when: ['giving'],
      subs: ['Charity', 'Community contributions'] },
    { key: 'travel', name: 'Travel', type: 'expense', icon: 'plane', color: '#0ea5e9', when: ['travel'],
      subs: ['Tickets', 'Stay', 'Local travel'] },
    { key: 'fun', name: 'Fun', type: 'expense', icon: 'film', color: '#a855f7', when: ['always'],
      subs: ['Outings', 'Subscriptions'] },
    { key: 'pets', name: 'Pets', type: 'expense', icon: 'paw-print', color: '#d97706', when: ['pets'],
      subs: ['Food', 'Vet'] },
    { key: 'fitness', name: 'Fitness', type: 'expense', icon: 'dumbbell', color: '#84cc16', when: ['fitness'],
      subs: ['Gym', 'Sports'] },
    { key: 'business', name: 'Business', type: 'expense', icon: 'briefcase', color: '#475569', when: ['business'],
      subs: ['Stock', 'Salaries', 'Rent', 'Other'] },
    { key: 'income', name: 'Income', type: 'income', icon: 'banknote', color: '#22c55e', when: ['always'],
      subs: ['Other'], extra: { salary: 'Salary', business: 'Business', rentin: 'Rent received', family: 'From family', investments: 'Investments' } },
  ]);

  /**
   * What to tick for a set of answers.
   * @param {Set<string>|string[]} answers  life and income chip keys
   * @returns {{key:string, name:string, type:string, icon:string, color:string, on:boolean, subs:{name:string, on:boolean}[]}[]}
   */
  static plan(answers) {
    const has = new Set(answers);
    return StarterCategories.LIST.map((m) => {
      const extras = Object.entries(m.extra || {}).map(([k, name]) => ({ name, on: has.has(k) }));
      const subs = [...extras, ...m.subs.map((name) => ({ name, on: true }))];
      const on = m.when.includes('always') || m.when.some((k) => has.has(k));
      return { key: m.key, name: m.name, type: m.type, icon: m.icon, color: m.color, on, subs };
    });
  }
}
