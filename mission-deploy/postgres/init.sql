-- One Postgres server, one database per simulated node (local development only).
-- On real ships each node runs its own Postgres in its own cluster.
create database mission_shore;
create database mission_ship_ddgb;
