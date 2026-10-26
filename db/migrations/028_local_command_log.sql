-- Komut logları ▸ "Tahtada yerel" (source = 'local'): tahtadaki kullanıcıların kendi çalıştırdığı yetkili
-- komutlar — sudo, pkexec, su. Tahtalar bunları syslog ile zaten gönderiyor (auth/authpriv); bu tetikleyici
-- `logs`'a gelen satırı anında ayrıştırıp command_log'a KOPYALAR. Böylece syslog saklama süresi, Disk
-- kullanımından log silme ya da tahta silme `logs`'u temizlese de komut kaydı kalır (kullanıcı isteği).
-- (Tahta silinince command_log.board_id NULL olur, board_name kalır — bkz. command_log_board_id_fkey.)
--
-- Sıradan terminal komutları (ls, rm …) syslog'a gitmez; burada yalnız yetki yükselten komutlar görünür.
-- Tetikleyiciyi çağıran root ise atlanır: ankamon'un kendi otomasyonu (ör. "root : … USER=ogretmen ;
-- COMMAND=/usr/bin/env DISPLAY=…", "(to x) root on none") kullanıcının yaptığı bir şey değil.
-- status: 'ok' (çalıştı) ya da 'denied' (parola yanlış, sudoers'ta yok, polkit reddetti, su başarısız).

CREATE OR REPLACE FUNCTION local_command_from_log(l_time timestamptz, l_host text, l_ip text,
                                                  l_program text, l_message text) RETURNS void
LANGUAGE plpgsql AS $$
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
      FROM boards WHERE lower(hostname) = lower(l_host) ORDER BY id LIMIT 1;
    IF bid IS NULL AND l_ip ~ '^[0-9a-fA-F.:]+$' THEN
        SELECT id, COALESCE(NULLIF(label, ''), hostname, host(ip)) INTO bid, bname
          FROM boards WHERE ip = l_ip::inet ORDER BY id LIMIT 1;
    END IF;

    INSERT INTO command_log (time, board_id, board_name, username, source, command, status)
    VALUES (l_time, bid, COALESCE(bname, l_host, l_ip), who, 'local', cmd, CASE WHEN denied THEN 'denied' ELSE 'ok' END);
END $$;

-- Tetikleyici hiçbir koşulda log yazımını bozmamalı (rsyslog INSERT'i düşerse syslog kaybolur): hata yutulur.
CREATE OR REPLACE FUNCTION logs_local_command() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        PERFORM local_command_from_log(NEW.received_at, NEW.host, NEW.from_ip, NEW.program, NEW.message);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'yerel komut kaydı atlandı: %', SQLERRM;
    END;
    RETURN NULL;
END $$;

-- Geçmiş: hâlâ `logs`'ta duran eski satırlar bir kez aktarılır (tetikleyiciden ÖNCE — çift kayıt olmasın).
SELECT count(*) AS aktarilan FROM (
    SELECT local_command_from_log(received_at, host, from_ip, program, message)
      FROM logs WHERE program IN ('sudo', 'pkexec', 'su') ORDER BY received_at) s;

DROP TRIGGER IF EXISTS logs_local_command ON logs;
CREATE TRIGGER logs_local_command AFTER INSERT ON logs
    FOR EACH ROW WHEN (NEW.program IN ('sudo', 'pkexec', 'su'))
    EXECUTE FUNCTION logs_local_command();
