-- Tiha-Mon oturum geçmişinin (login_sessions, göç 019) "oturum ne zaman bitti" kuralları — kullanıcı
-- bildirdi: aynı kişinin saniyeler arayla onlarca "açık/boşta", saatler süren, işlemsiz kaydı; kapanmış
-- tarayıcıların oturumları alt çubukta açık görünüyordu.
--
--  * 'replaced': aynı tarayıcıdan çıkış yapmadan yeniden giriş yapıldı — eski belirteç Auth::start'ta
--    sonlandırılır (önceden 12 sa geçerli kalıp "açık" bir kayıt daha bırakıyordu).
--  * Tarayıcı çıkış yapmadan kapatılınca belirteç süresi dolana kadar geçerlidir; bu durum veritabanına
--    yazılmaz, okunurken türetilir: son istekten (last_seen_at) beri LoginSessionsApi::PRESENCE_MINUTES
--    geçtiyse "bağlantı kesildi". Belirteç geri dönerse (tarayıcı yeniden açıldı) oturum sürer.
--  * Süresi dolan (expired) oturumun bitişi son KULLANIM anıdır (last_seen_at), süre dolma anı (son
--    kullanımdan 12 sa sonrası) değil — "saatler süren" oturum yanılgısının kaynağı buydu.
ALTER TABLE login_sessions DROP CONSTRAINT IF EXISTS login_sessions_end_reason_check;
ALTER TABLE login_sessions ADD CONSTRAINT login_sessions_end_reason_check
    CHECK (end_reason IN ('logout', 'expired', 'revoked', 'replaced'));

CREATE OR REPLACE FUNCTION login_sessions_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO login_sessions (session_hash, user_id, username, ip, user_agent, started_at, last_seen_at, expires_at)
        SELECT NEW.id, NEW.user_id, u.username, NEW.ip, NEW.user_agent, NEW.created_at, NEW.created_at, NEW.expires_at
        FROM users u WHERE u.id = NEW.user_id
        ON CONFLICT (session_hash) DO NOTHING;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        UPDATE login_sessions SET expires_at = NEW.expires_at WHERE session_hash = NEW.id;
        RETURN NEW;
    ELSE
        -- Neden yazılmamışsa (Auth::end/start yazar): süresi geçmişse 'expired' — bitiş son kullanım anı;
        -- değilse 'revoked' (yönetici/parola değişimi sonlandırdı) — bitiş şimdi.
        UPDATE login_sessions
           SET end_reason = coalesce(end_reason, CASE WHEN OLD.expires_at <= now() THEN 'expired' ELSE 'revoked' END),
               ended_at   = coalesce(ended_at, CASE WHEN OLD.expires_at <= now()
                                                    THEN coalesce(last_seen_at, started_at) ELSE now() END)
         WHERE session_hash = OLD.id;
        RETURN OLD;
    END IF;
END $$;

-- Mevcut kayıtlar: süresi dolmuşların bitişi son kullanıma çekilir.
UPDATE login_sessions SET ended_at = coalesce(last_seen_at, started_at)
 WHERE end_reason = 'expired' AND last_seen_at IS NOT NULL AND ended_at > last_seen_at;
