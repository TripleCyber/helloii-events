create table media (
    id uuid primary key default gen_random_uuid(),
    kind text not null check (kind in ('poster', 'logo', 'photo')),
    content_type text not null,
    bytes bytea not null,
    created_at timestamptz not null default now()
);

create table events (
    id uuid primary key default gen_random_uuid(),
    code text not null unique check (code ~ '^[A-Za-z0-9]{10,16}$'),
    title text not null,
    description text not null default '',
    venue text not null default '',
    organizer_name text not null default '',
    organizer_color text not null default '#0F1E29',
    organizer_logo uuid references media (id),
    starts_at timestamptz not null,
    ends_at timestamptz not null,
    check_in_opens_at timestamptz not null,
    check_in_closes_at timestamptz not null,
    cancelled boolean not null default false,
    theme jsonb not null default '{}'::jsonb,
    kiosk_token text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (ends_at > starts_at),
    check (check_in_closes_at > check_in_opens_at),
    check (check_in_closes_at <= ends_at)
);

create table event_posters (
    event_id uuid not null references events (id) on delete cascade,
    position int not null,
    media_id uuid not null references media (id),
    width int not null check (width between 1 and 8192),
    height int not null check (height between 1 and 8192),
    primary key (event_id, position)
);

create table check_ins (
    id bigint generated always as identity primary key,
    event_id uuid not null references events (id) on delete cascade,
    user_jid text not null,
    first_name text not null,
    display_name text not null,
    photo uuid references media (id),
    checked_in_at timestamptz not null default now(),
    unique (event_id, user_jid)
);

create index check_ins_event_time on check_ins (event_id, checked_in_at desc);
