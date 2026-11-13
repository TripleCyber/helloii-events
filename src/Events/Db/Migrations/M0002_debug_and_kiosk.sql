alter table events
    add column debug boolean not null default false,
    add column kiosk_orientation text not null default 'auto'
        check (kiosk_orientation in ('auto', 'landscape', 'portrait', 'portrait-left'));
