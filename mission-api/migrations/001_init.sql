-- Mission node store. One database per node (ship or shore).
-- Facts and decisions are append-only; rows are never updated in place.
-- Integrity is carried by the hash chains (verified on load), not by the table.

create table if not exists node_info (
  id          text primary key,
  kind        text not null check (kind in ('ship', 'shore')),
  ship        text,
  mission     text not null,
  created_at  timestamptz not null default now()
);

create table if not exists fact (
  seq          integer primary key,
  id           text not null unique,            -- content id: identical on every node
  hash         text not null,                   -- this node's chain hash
  prev_hash    text not null,
  entity       text not null,
  attr         text not null,
  recorded_at  double precision not null,       -- scenario hours
  received_at  double precision,                -- set when the fact arrived late (sync)
  origin       text,
  quarantine   text,
  body         jsonb not null,                  -- the full fact content (±Infinity spelled out)
  inserted_at  timestamptz not null default now()
);
create index if not exists fact_entity_attr on fact (entity, attr);

create table if not exists decision (
  seq          integer primary key,
  hash         text not null unique,
  prev_hash    text not null,
  kind         text not null,
  at           double precision not null,
  actor_id     text not null,
  body         jsonb not null,
  inserted_at  timestamptz not null default now()
);

-- Decision logs received from other nodes: kept per node, verified per chain, never merged into ours.
create table if not exists peer_decision (
  node         text not null,
  seq          integer not null,
  hash         text not null,
  body         jsonb not null,
  received_at  double precision not null,
  inserted_at  timestamptz not null default now(),
  primary key (node, seq)
);

create table if not exists sync_state (
  peer           text primary key,
  pushed_seq     integer not null default -1,
  pushed_dec     integer not null default -1,
  pulled_seq     integer not null default -1,
  last_ok_t      double precision,
  last_ok_wall   timestamptz,
  facts_in       integer not null default 0,
  last_error     text
);

create table if not exists runtime_state (
  key    text primary key,
  value  jsonb not null
);
