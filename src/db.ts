import { SQL } from "bun";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

export const sql = new SQL(url);

const MIGRATIONS: string[] = [
  // 1: initial schema
  `
  create table users (
    id serial primary key,
    username text not null unique,
    display_name text not null,
    password_hash text not null,
    is_public boolean not null default false,
    timezone text not null default 'America/New_York',
    created_at timestamptz not null default now()
  );
  create table sessions (
    token text primary key,
    user_id int not null references users(id) on delete cascade,
    expires_at timestamptz not null
  );
  create index sessions_user on sessions(user_id);
  create table projects (
    id serial primary key,
    user_id int not null references users(id) on delete cascade,
    type text not null,
    title text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create index projects_user on projects(user_id);
  create table nodes (
    id serial primary key,
    project_id int not null references projects(id) on delete cascade,
    parent_id int references nodes(id) on delete cascade,
    kind text not null,
    title text not null default '',
    summary text not null default '',
    body text not null default '',
    words int not null default 0,
    position double precision not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create index nodes_project on nodes(project_id);
  -- Per node, per day: the word count when the day's first edit began
  -- (baseline), the latest count, and words that arrived by pasting.
  -- No foreign key to nodes on purpose: deleting a scene does not erase
  -- the words you wrote that day.
  create table node_days (
    user_id int not null references users(id) on delete cascade,
    node_id int not null,
    day date not null,
    baseline int not null,
    current int not null,
    pasted int not null default 0,
    primary key (user_id, node_id, day)
  );
  create index node_days_user_day on node_days(user_id, day);
  create table follows (
    follower_id int not null references users(id) on delete cascade,
    followee_id int not null references users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (follower_id, followee_id)
  );
  `,
  // 2: optional email + password resets
  `
  alter table users add column email text;
  create index users_email on users (lower(email));
  create table password_resets (
    token text primary key,
    user_id int not null references users(id) on delete cascade,
    expires_at timestamptz not null,
    used_at timestamptz
  );
  create index password_resets_user on password_resets(user_id);
  `,
];

export async function migrate() {
  await sql.unsafe(`create table if not exists schema_version (version int not null)`);
  const rows = await sql`select version from schema_version`;
  let version = rows.length ? rows[0].version : 0;
  if (!rows.length) await sql`insert into schema_version (version) values (0)`;
  for (let i = version; i < MIGRATIONS.length; i++) {
    await sql.begin(async (tx) => {
      await tx.unsafe(MIGRATIONS[i]);
      await tx`update schema_version set version = ${i + 1}`;
    });
    console.log(`migration ${i + 1} applied`);
  }
}
