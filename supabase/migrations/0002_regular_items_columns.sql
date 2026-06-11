-- 0002: columns the legacy regular-purchases feature needs.
-- The legacy RegularItemModal stores default amount, icon, color and
-- frequency per item; 0001 only created the bare table.

alter table regular_items
  add column if not exists default_amount_minor bigint not null default 0,
  add column if not exists icon      text not null default 'coffee',
  add column if not exists color     text not null default '#f97316',
  add column if not exists frequency text not null default 'monthly';
