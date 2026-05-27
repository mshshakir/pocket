/**
 * SeedFactory — generates fresh sample data for new users.
 *
 * Extracted from the monolithic seed() function into a proper class
 * so it can be injected, tested, and replaced independently.
 */
import { DEFAULT_CATEGORIES } from './constants.js';
import { IdGenerator } from '../domain/services/IdGenerator.js';

export class SeedFactory {
  /**
   * Build and return a complete initial state object.
   * @returns {object}
   */
  static create() {
    const uid = (prefix) => IdGenerator.generate(prefix);

    const cats = DEFAULT_CATEGORIES.map((c) => ({
      id: uid('cat'),
      parentId: null,
      budgetLimit: null,
      ...c,
    }));
    const catBy = (name) => cats.find((c) => c.name === name).id;

    const accounts = [
      { id: uid('acc'), name: 'Main Checking',  type: 'bank',    currency: 'USD', balance:  250000,  color: '#0ea5e9', icon: 'landmark',    archived: false },
      { id: uid('acc'), name: 'Cash Wallet',    type: 'cash',    currency: 'USD', balance:   15000,  color: '#22c55e', icon: 'wallet',      archived: false },
      { id: uid('acc'), name: 'Visa Platinum',  type: 'card',    currency: 'USD', balance:  -42000,  color: '#a855f7', icon: 'credit-card', archived: false },
      { id: uid('acc'), name: 'High-Yield Save',type: 'savings', currency: 'USD', balance: 1240000,  color: '#14b8a6', icon: 'landmark',    archived: false },
    ];

    const today = new Date();
    const daysAgo = (n) => {
      const d = new Date(today);
      d.setDate(d.getDate() - n);
      return d.toISOString().slice(0, 10);
    };

    const expenseSamples = [
      ['Whole Foods Market', 'Food & Drink',  4732, ''                   ],
      ['Starbucks',          'Food & Drink',   587, 'Latte + croissant'  ],
      ['Uber',               'Transport',     1825, 'Ride to airport'    ],
      ['Shell',              'Transport',     4210, 'Gas fill-up'        ],
      ['Netflix',            'Entertainment', 1599, 'Monthly subscription'],
      ['Spotify',            'Entertainment',  999, ''                   ],
      ['Amazon',             'Shopping',      6745, 'USB-C cables'       ],
      ['Walgreens',          'Health',        1234, 'Vitamins'           ],
      ['Trader Joe\'s',      'Food & Drink',  5921, 'Weekly groceries'   ],
      ['Chipotle',           'Food & Drink',  1525, ''                   ],
      ['Electric Co.',       'Bills',         8230, 'May power bill'     ],
      ['Internet Provider',  'Bills',         7500, ''                   ],
      ['Cinema',             'Entertainment', 2800, 'Movie + popcorn'    ],
      ['Bookstore',          'Shopping',      2700, 'Two paperbacks'     ],
      ['Rent Payment',       'Housing',     180000, 'May rent'           ],
      ['Pharmacy',           'Health',        1899, ''                   ],
      ['Coffee Bar',         'Food & Drink',   475, ''                   ],
      ['Lyft',               'Transport',     1145, ''                   ],
      ['Coursera',           'Education',     4900, 'Course renewal'     ],
      ['H&M',                'Shopping',      3299, 'T-shirts'           ],
    ];

    const transactions = expenseSamples.map((s, i) => ({
      id: uid('tx'),
      accountId:      accounts[i % 3].id,
      categoryId:     catBy(s[1]),
      amount:         s[2],
      currency:       'USD',
      exchangeRate:   1,
      refAmount:      s[2],
      payee:          s[0],
      note:           s[3],
      date:           daysAgo(Math.floor(Math.random() * 45)),
      paymentType:    'card',
      recordState:    'cleared',
      type:           'expense',
      transferPairId: null,
      tags:           [],
    }));

    ['Salary', 'Freelance'].forEach((cat, i) => {
      transactions.push({
        id:             uid('tx'),
        accountId:      accounts[0].id,
        categoryId:     catBy(cat),
        amount:         cat === 'Salary' ? 580000 : 120000,
        currency:       'USD',
        exchangeRate:   1,
        refAmount:      cat === 'Salary' ? 580000 : 120000,
        payee:          cat === 'Salary' ? 'Acme Corp' : 'Side project',
        note:           cat === 'Salary' ? 'Monthly payroll' : 'Design contract',
        date:           daysAgo(i * 15 + 3),
        paymentType:    'transfer',
        recordState:    'cleared',
        type:           'income',
        transferPairId: null,
        tags:           [],
      });
    });

    const budgets = [
      { id: uid('bg'), categoryId: catBy('Food & Drink'),  amount:  60000, currency: 'USD', period: 'monthly', rollover: false },
      { id: uid('bg'), categoryId: catBy('Transport'),     amount:  20000, currency: 'USD', period: 'monthly', rollover: false },
      { id: uid('bg'), categoryId: catBy('Shopping'),      amount:  25000, currency: 'USD', period: 'monthly', rollover: false },
      { id: uid('bg'), categoryId: catBy('Entertainment'), amount:  10000, currency: 'USD', period: 'monthly', rollover: false },
    ];

    return {
      user: {
        homeCurrency:    'USD',
        defaultCurrency: 'USD',
        theme:           'system',
        showHijri:       true,
        calendarMode:    'both',
        dateFormat:      'auto',
        geminiApiKey:    '',
        supabaseUrl:     '',
        supabaseKey:     '',
        customPaymentTypes:       [],
        collapsedAccountGroups:   [],
        collapsedCategories:      [],
      },
      accounts,
      categories:        cats,
      transactions,
      budgets,
      merchantCategories: {},
      debts:              [],
      regularItems:       [],
      accountGroups:      [],
      family:             [],
    };
  }
}
