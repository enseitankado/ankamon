-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Terim geçişi 3/3 (kullanıcı isteği 2026-11-12): yönetilen istemciler "tahta" (board) değil "cihaz" (device).
-- "Akıllı tahta" cihazların alt kapsamıdır: boards.smart_board işareti ve 'Akıllı tahta' aygıt türü değeri korunur.
--  - tablolar: boards → devices, board_blocklist/credentials/sessions/uptime → device_*; dizileri, dizinleri, kısıtları
--  - çekirdek tablolardaki sütunlar: board_id → device_id, board_name → device_name, board_ids → device_ids,
--    source_/target_board_id → source_/target_device_id (metrics_tag.board_id dahil — Telegraf etiketi de device_id oldu)
--  - görünümler: v_boards → v_devices; v_metrics* device_id sütunuyla yeniden; işlevler yeni adlarla
--  - saklı değerler: izin adları (boards → devices), arayüz tercih anahtarları, lig dışı türü, ayar anahtarı,
--    denetim kaydı eylemleri, eski görev parametresi
-- Eklentilerin tabloları (ahenk_*, envanter_*, tiha_*, eta_checks) eklentilerindir: board_id sütunları ve kısıt adları değişmez; dış
-- anahtarları yeni tabloyu izler. Eklentilerin eski adlarla sorguları bozulmasın diye UYUMLULUK GÖRÜNÜMLERİ: boards,
-- board_credentials (yalnız okuma/yazma kolaylığı; yeni kodda devices / device_credentials kullanılır). Tek işlem: yarıda
-- kalırsa hiçbir şey değişmez ve bir sonraki açılışta yeniden denenir.
BEGIN;

DO $$
DECLARE
    r record;
BEGIN
    IF to_regclass('public.devices') IS NOT NULL AND to_regclass('public.boards') IS NOT NULL
       AND (SELECT relkind FROM pg_class WHERE oid = 'public.boards'::regclass) = 'r' THEN
        RAISE EXCEPTION 'hem boards hem devices tablosu var — elle incelenmeli';
    END IF;

    -- Tablolar ve dizileri
    IF to_regclass('public.boards') IS NOT NULL AND (SELECT relkind FROM pg_class WHERE oid = 'public.boards'::regclass) = 'r' THEN
        EXECUTE 'DROP VIEW IF EXISTS v_boards';
        ALTER TABLE boards RENAME TO devices;
    END IF;
    IF to_regclass('public.board_blocklist') IS NOT NULL THEN ALTER TABLE board_blocklist RENAME TO device_blocklist; END IF;
    IF to_regclass('public.board_credentials') IS NOT NULL
       AND (SELECT relkind FROM pg_class WHERE oid = 'public.board_credentials'::regclass) = 'r' THEN
        ALTER TABLE board_credentials RENAME TO device_credentials;
    END IF;
    IF to_regclass('public.board_sessions') IS NOT NULL THEN ALTER TABLE board_sessions RENAME TO device_sessions; END IF;
    IF to_regclass('public.board_uptime') IS NOT NULL THEN ALTER TABLE board_uptime RENAME TO device_uptime; END IF;
    FOR r IN SELECT sequence_name FROM information_schema.sequences
             WHERE sequence_schema = 'public' AND sequence_name LIKE 'board%'
    LOOP
        EXECUTE format('ALTER SEQUENCE %I RENAME TO %I', r.sequence_name, replace(r.sequence_name, 'board', 'device'));
    END LOOP;

    -- v_metrics* metrics_tag.board_id'yi seçer: sütun adı değişmeden önce düşürülür (aşağıda yeniden kurulur).
    DROP VIEW IF EXISTS v_metrics, v_metrics_5m, v_metrics_1h;

    -- Çekirdek tablolardaki sütunlar (eklenti tabloları hariç; akıllı tahta işareti smart_board korunur)
    FOR r IN SELECT c.table_name, c.column_name FROM information_schema.columns c
             JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
             WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.column_name LIKE '%board%'
               AND c.column_name <> 'smart_board'
               AND c.table_name !~ '^(ahenk_|envanter_|tiha_|eta_checks$|_)'
    LOOP
        EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO %I', r.table_name, r.column_name,
                       replace(r.column_name, 'board', 'device'));
    END LOOP;

    -- Dizinler (kısıt dizinleri dahil — dizin adı değişince birincil/tekil kısıt adı da değişir)
    FOR r IN SELECT i.indexname, i.tablename FROM pg_indexes i
             WHERE i.schemaname = 'public' AND i.indexname LIKE '%board%' AND i.tablename !~ '^(ahenk_|envanter_|tiha_|eta_checks$)'
    LOOP
        EXECUTE format('ALTER INDEX %I RENAME TO %I', r.indexname, replace(r.indexname, 'board', 'device'));
    END LOOP;
    -- Dizinsiz kısıtlar (dış anahtar, denetim)
    FOR r IN SELECT con.conname, rel.relname FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
             JOIN pg_namespace ns ON ns.oid = rel.relnamespace
             WHERE ns.nspname = 'public' AND con.conname LIKE '%board%' AND con.contype IN ('f', 'c')
               AND rel.relname !~ '^(ahenk_|envanter_|tiha_|eta_checks$)'
    LOOP
        EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', r.relname, r.conname, replace(r.conname, 'board', 'device'));
    END LOOP;
END $$;

-- Görünümler
CREATE OR REPLACE VIEW v_devices AS
SELECT id, COALESCE(NULLIF(label, ''), hostname, host(ip)) AS name, hostname, host(ip) AS ip, mac::text AS mac,
       location, online, exporter_ok, last_seen_at
FROM devices;

CREATE OR REPLACE VIEW v_metrics AS
SELECT m.time, NULLIF(t.device_id, '')::integer AS device_id, t.name, t.cpu, t.mode, t.device,
       t.mountpoint, t.fstype, t.chip, t.sensor, t.type, t.zone, m.value
FROM metrics m JOIN metrics_tag t USING (tag_id);

CREATE OR REPLACE VIEW v_metrics_5m AS
SELECT m.time, NULLIF(t.device_id, '')::integer AS device_id, t.name, t.cpu, t.mode, t.device,
       t.mountpoint, t.fstype, t.chip, t.sensor, t.type, t.zone, m.value, m.min, m.max, m.last
FROM metrics_5m m JOIN metrics_tag t USING (tag_id);

CREATE OR REPLACE VIEW v_metrics_1h AS
SELECT m.time, NULLIF(t.device_id, '')::integer AS device_id, t.name, t.cpu, t.mode, t.device,
       t.mountpoint, t.fstype, t.chip, t.sensor, t.type, t.zone, m.value, m.min, m.max, m.last
FROM metrics_1h m JOIN metrics_tag t USING (tag_id);

-- İşlevler: parametre adı değiştiğinden önce düşürülür
DROP FUNCTION IF EXISTS device_os_family(integer);
DROP FUNCTION IF EXISTS device_os_source(integer);
CREATE OR REPLACE FUNCTION public.device_os_family(p_device_id integer)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
    SELECT COALESCE(
        b.os_family,
        device_os_family_of(b.facts->>'os_name'),
        (SELECT device_os_family_of(d.os_guess) FROM net_devices d
          WHERE d.mac IN (b.mac, b.wifi_mac) AND COALESCE(d.os_guess, '') <> ''
          ORDER BY d.last_seen_at DESC NULLS LAST LIMIT 1))
    FROM devices b WHERE b.id = p_device_id
$function$
;
CREATE OR REPLACE FUNCTION public.device_os_source(p_device_id integer)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
    SELECT CASE
        WHEN b.os_family IS NOT NULL THEN 'manual'
        WHEN device_os_family_of(b.facts->>'os_name') IS NOT NULL THEN 'ssh'
        WHEN EXISTS (SELECT 1 FROM net_devices d WHERE d.mac IN (b.mac, b.wifi_mac) AND COALESCE(d.os_guess, '') <> '') THEN 'scan'
    END
    FROM devices b WHERE b.id = p_device_id
$function$
;
CREATE OR REPLACE FUNCTION public.local_command_from_log(l_time timestamp with time zone, l_host text, l_ip text, l_program text, l_message text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    who text; runas text; cmd text; m text[]; denied boolean := false;
    bid integer; bname text;
BEGIN
    IF l_program = 'sudo' THEN
        -- "ali : TTY=pts/0 ; PWD=/home/ali ; USER=root ; COMMAND=/usr/bin/apt update"
        -- "ali : user NOT in sudoers ; TTY=… ; COMMAND=…", "ali : 3 incorrect password attempts ; …"
        who := substring(l_message from '^\s*(\S+) : ');
        cmd := substring(l_message from ' COMMAND=(.*)$');
        runas := substring(l_message from '; USER=([^ ;]+) ;');
        denied := l_message ~ '(incorrect password|NOT in sudoers|command not allowed|a password is required)';
        IF cmd IS NULL THEN RETURN; END IF;
        cmd := 'sudo ' || CASE WHEN coalesce(runas, 'root') <> 'root' THEN '-u ' || runas || ' ' ELSE '' END || cmd;
    ELSIF l_program = 'pkexec' THEN
        -- "ali: Executing command [USER=root] [TTY=unknown] [CWD=/home/ali] [COMMAND=/usr/bin/x]"
        -- "ali: Error executing command as another user: Not authorized [USER=root] … [COMMAND=…]"
        who := substring(l_message from '^(\S+): ');
        cmd := substring(l_message from '\[COMMAND=(.*)\]\s*$');
        runas := substring(l_message from '\[USER=([^]]+)\]');
        denied := l_message LIKE '%Error executing command%';
        IF cmd IS NULL THEN RETURN; END IF;
        cmd := 'pkexec ' || CASE WHEN coalesce(runas, 'root') <> 'root' THEN '--user ' || runas || ' ' ELSE '' END || cmd;
    ELSIF l_program = 'su' THEN
        -- "(to root) ali on pts/1" / "FAILED SU (to root) ali on pts/1"
        m := regexp_match(l_message, '^(FAILED SU )?\(to (\S+)\) (\S+) on ');
        IF m IS NULL THEN RETURN; END IF;
        who := m[3];
        denied := m[1] IS NOT NULL;
        cmd := 'su ' || m[2];
    ELSE
        RETURN;
    END IF;
    IF who IS NULL OR who = 'root' THEN
        RETURN;
    END IF;

    SELECT id, COALESCE(NULLIF(label, ''), hostname, host(ip)) INTO bid, bname
      FROM devices WHERE lower(hostname) = lower(l_host) ORDER BY id LIMIT 1;
    IF bid IS NULL AND l_ip ~ '^[0-9a-fA-F.:]+$' THEN
        SELECT id, COALESCE(NULLIF(label, ''), hostname, host(ip)) INTO bid, bname
          FROM devices WHERE ip = l_ip::inet ORDER BY id LIMIT 1;
    END IF;

    INSERT INTO command_log (time, device_id, device_name, username, source, command, status)
    VALUES (l_time, bid, COALESCE(bname, l_host, l_ip), who, 'local', cmd, CASE WHEN denied THEN 'denied' ELSE 'ok' END);
END $function$
;


-- Eklentiler için uyumluluk görünümleri (eski adlarla okuma/yazma; tek tablolu basit görünüm kendiliğinden güncellenebilir).
CREATE OR REPLACE VIEW boards AS SELECT * FROM devices;
DO $$
DECLARE
    cols text;
BEGIN
    SELECT string_agg(CASE WHEN column_name = 'device_id' THEN 'device_id AS board_id' ELSE quote_ident(column_name) END,
                      ', ' ORDER BY ordinal_position)
      INTO cols FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'device_credentials';
    IF cols IS NOT NULL THEN
        EXECUTE 'CREATE OR REPLACE VIEW board_credentials AS SELECT ' || cols || ' FROM device_credentials';
    END IF;
END $$;

-- Saklı değerler
UPDATE users SET features = (SELECT array_agg(regexp_replace(f, '^boards', 'devices') ORDER BY i)
                             FROM unnest(features) WITH ORDINALITY AS u(f, i))
 WHERE array_to_string(features, ',') ~ '(^|,)boards';
UPDATE users SET ui_prefs = regexp_replace(ui_prefs::text, '\mboard(s?)(?!_model)(?![a-z])', 'device\1', 'g')::jsonb
 WHERE ui_prefs::text ~ '\mboards?(?!_model)(?![a-z])';
UPDATE users SET nav_order = regexp_replace(nav_order::text, '\mboard(s?)(?![a-z])', 'device\1', 'g')::jsonb
 WHERE nav_order::text ~ '\mboards?(?![a-z])';
ALTER TABLE league_exclusions DROP CONSTRAINT IF EXISTS league_exclusions_kind_check;
UPDATE league_exclusions SET kind = 'device' WHERE kind = 'board';
ALTER TABLE league_exclusions ADD CONSTRAINT league_exclusions_kind_check CHECK (kind IN ('user', 'device'));
UPDATE settings SET key = 'device_access' WHERE key = 'board_access'
   AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'device_access');
UPDATE audit_log SET action = regexp_replace(action, '^board\.', 'device.') WHERE action ~ '^board\.';
UPDATE jobs SET params = params - 'source_board_id' || jsonb_build_object('source_device_id', params->'source_board_id')
 WHERE jsonb_typeof(params) = 'object' AND params ? 'source_board_id';

COMMIT;
