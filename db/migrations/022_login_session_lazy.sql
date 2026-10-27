-- SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Oturum geçmişinde (login_sessions) betik/otomasyon girişleri birikmesin (kullanıcı bildirdi, 2026-10-19:
-- etapadmin'in 127.0.0.1'den onlarca "0 sn" oturumu — Claude oturumlarının API/headless testleri).
--  * Geçmiş kaydı artık GİRİŞTE (sessions INSERT tetikleyicisi) değil, arayüz İLK AÇILDIĞINDA oluşur: alt
--    çubuğun durum bildirimi (LoginSessionsApi::active ?focused=) kaydı yazar. Yalnız API kullanan betikler
--    (Python-urllib…) hiç kayıt bırakmaz; giriş/çıkış audit_log'da yine durur.
--  * Kısa ve işlemsiz oturumlar (bitmiş/bağlantısı kesilmiş, < 20 sn, giriş/çıkış dışında işlem yok)
--    listelenmeden önce silinir (LoginSessionsApi::purgeShort) — mevcut test kayıtları da böyle temizlenir.
-- UPDATE/DELETE dalları 021 ile aynı (yalnız kaydı olan oturumları etkiler).
CREATE OR REPLACE FUNCTION login_sessions_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        RETURN NEW;   -- kayıt arayüz açılınca oluşur (bkz. LoginSessionsApi::active)
    ELSIF TG_OP = 'UPDATE' THEN
        UPDATE login_sessions SET expires_at = NEW.expires_at WHERE session_hash = NEW.id;
        RETURN NEW;
    ELSE
        UPDATE login_sessions
           SET end_reason = coalesce(end_reason, CASE WHEN OLD.expires_at <= now() THEN 'expired' ELSE 'revoked' END),
               ended_at   = coalesce(ended_at, CASE WHEN OLD.expires_at <= now()
                                                    THEN coalesce(last_seen_at, started_at) ELSE now() END)
         WHERE session_hash = OLD.id;
        RETURN OLD;
    END IF;
END $$;
