-- One node runs several missions. Every log is scoped to its mission; chains
-- are per mission (each starts from genesis), so a mission can be verified,
-- exported or reset on its own. Rows written before this migration belonged
-- to the only mission the node ran then (STEEL TIDE).

alter table fact add column if not exists mission text not null default 'steel-tide';
alter table fact drop constraint if exists fact_pkey;
alter table fact drop constraint if exists fact_id_key;
alter table fact add primary key (mission, seq);
alter table fact add constraint fact_mission_id_key unique (mission, id);
drop index if exists fact_entity_attr;
create index if not exists fact_mission_entity_attr on fact (mission, entity, attr);

alter table decision add column if not exists mission text not null default 'steel-tide';
alter table decision drop constraint if exists decision_pkey;
alter table decision drop constraint if exists decision_hash_key;
alter table decision add primary key (mission, seq);
alter table decision add constraint decision_mission_hash_key unique (mission, hash);

alter table peer_decision add column if not exists mission text not null default 'steel-tide';
alter table peer_decision drop constraint if exists peer_decision_pkey;
alter table peer_decision add primary key (mission, node, seq);

alter table sync_state add column if not exists mission text not null default 'steel-tide';
alter table sync_state drop constraint if exists sync_state_pkey;
alter table sync_state add primary key (mission, peer);

-- runtime_state keys are now "<mission>:<key>" (node-wide keys use "node:").
update runtime_state set key = 'steel-tide:' || key where key not like '%:%';

-- node_info.mission described the single mission; the node now serves a set.
alter table node_info alter column mission drop not null;

alter table fact alter column mission drop default;
alter table decision alter column mission drop default;
alter table peer_decision alter column mission drop default;
alter table sync_state alter column mission drop default;
