-- Ankamon oturum geçmişi (Kullanıcılar ▸ Oturumlar sekmesi, alt çubuktaki "oturum açmış kullanıcılar").
-- `sessions` yalnız GEÇERLİ oturumları tutar ve çıkışta/süre dolunca satır silinir; geçmiş burada kalır.
-- Bakımı tetikleyiciler yapar: sessions'a eklenen/uzatılan/silinen her satır buraya yansır — oturumu
-- silen her yol (çıkış, parola değişimi, kullanıcıyı pasifleştirme, süre dolmuşların temizliği) kapsanır.
-- Çıkış nedeni: Auth::end önce end_reason='logout' yazar; silmede boşsa süresi geçmişse 'expired', değilse
-- 'revoked' (yönetici sonlandırdı). last_seen_at: Auth::user dakikada en çok bir kez günceller.
CREATE TABLE IF NOT EXISTS login_sessions (
    id           bigserial PRIMARY KEY,
    session_hash text UNIQUE,                 -- sessions.id (belirtecin SHA-256'sı); bitince de kalır
    user_id      integer REFERENCES users(id) ON DELETE SET NULL,
    username     text NOT NULL,
    ip           text,
    user_agent   text,
    started_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz,
    expires_at   timestamptz,
    ended_at     timestamptz,
    end_reason   text CHECK (end_reason IN ('logout', 'expired', 'revoked'))
);
CREATE INDEX IF NOT EXISTS login_sessions_started_idx ON login_sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS login_sessions_open_idx ON login_sessions (user_id) WHERE ended_at IS NULL;

-- Hangi oturumda hangi işlem yapıldı (Audit::log doldurur; eski kayıtlarda NULL).
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS login_session_id bigint;
CREATE INDEX IF NOT EXISTS audit_log_login_session_idx ON audit_log (login_session_id) WHERE login_session_id IS NOT NULL;

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
        UPDATE login_sessions
           SET end_reason = coalesce(end_reason, CASE WHEN OLD.expires_at <= now() THEN 'expired' ELSE 'revoked' END),
               ended_at   = coalesce(ended_at, least(now(), OLD.expires_at))
         WHERE session_hash = OLD.id;
        RETURN OLD;
    END IF;
END $$;

DROP TRIGGER IF EXISTS sessions_history ON sessions;
CREATE TRIGGER sessions_history AFTER INSERT OR DELETE OR UPDATE OF expires_at ON sessions
    FOR EACH ROW EXECUTE FUNCTION login_sessions_sync();

-- Göç anında açık olan oturumlar da geçmişe girsin.
INSERT INTO login_sessions (session_hash, user_id, username, ip, user_agent, started_at, last_seen_at, expires_at)
SELECT s.id, s.user_id, u.username, s.ip, s.user_agent, s.created_at, s.created_at, s.expires_at
FROM sessions s JOIN users u ON u.id = s.user_id
ON CONFLICT (session_hash) DO NOTHING;
