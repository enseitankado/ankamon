# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Ankamon — ETAP akıllı tahtaları için merkezi log, izleme ve yönetim sunucusu
# Copyright (C) 2026 Özgür Koca <ozgurkoca@gmail.com>
# https://github.com/enseitankado/ankamon
#
# Bu program özgür yazılımdır: Free Software Foundation tarafından yayımlanan
# GNU Affero Genel Kamu Lisansı'nın 3. sürümü ya da (tercihinize bağlı olarak)
# daha sonraki herhangi bir sürümü koşulları altında yeniden dağıtabilir ve/veya
# değiştirebilirsiniz.
#
# Bu program yararlı olması umuduyla dağıtılmaktadır, ancak HİÇBİR GARANTİSİ
# YOKTUR; satılabilirlik veya belirli bir amaca uygunluk garantisi dahi
# verilmez. Ayrıntılar için GNU Affero Genel Kamu Lisansı'na bakınız.
#
# Bu programla birlikte GNU Affero Genel Kamu Lisansı'nın bir kopyasını (LICENSE
# dosyası) almış olmalısınız. Almadıysanız <https://www.gnu.org/licenses/>
# adresine bakınız.
#
# Bu dosyadan (sınıf, işlev ya da işlev içi kod bloğu dahil) alınan her türlü
# parça da AGPL-3.0-or-later ile lisanslıdır: parçayı kullanan türev eser aynı
# lisansla yayımlanmalı, bu telif/atıf bildirimi ve değişiklik notu
# korunmalıdır; değiştirilmiş sürüm ağ üzerinden hizmet olarak sunulursa
# kullanıcılarına kaynak kodu sunulmalıdır (AGPLv3 madde 4, 5, 7(b) ve 13).

"""Cihazın ses durumu (kullanıcı isteği 2026-11-23): oturum açık kullanıcının ses sunucusunda varsayılan çıkış
sessizde mi, düzeyi kaç (%). Akıllı Tahtalar ▸ "Ses" sütunu ve Ekranlar kutucuğundaki sessiz hoparlör simgesi.

Oturum yoklamasının (executor/session_probe.py, 30 sn) aynı SSH turunda okunur — ek bağlantı açılmaz. ETAP/Pardus'ta
ses sunucusu kullanıcının oturumunda çalışır (pipewire-pulse, /run/user/<uid>/pulse/native); root, PULSE_SERVER ile o
sokete bağlanıp pactl ile okur (bkz. executor/cast.py — sesli yansıtma da aynı yolla düzey değiştirir). Seat0'daki
kullanıcı oturumu seçilir (etkin olan önce; dm-tool lock ile kilitliyken pasif oturum). Oturum yoksa, ses sunucusu ya da
gerçek çıkış yoksa (ekran DPMS ile kapalıyken HDMI çıkışı kaybolur, varsayılan "auto_null" kalır) satır yazılmaz:
değer bilinmiyor (NULL) sayılır. Sesi değiştirmek: actions/sound-control (sağ menü Yönet ▸ Ses kontrolü).

Ses sınırı (kullanıcı isteği 2026-11-24, göç 060): sound-control "limit" cihaza bekçi kurar
(/var/lib/ankamon-sound-limit/limit + ankamon-sound-limit.service); "AL <yüzde>" satırı oturumdan bağımsız okunur.
"""

from __future__ import annotations

# "A <yes|no> <düzey>" satırı. if/fi ile biter: koşul tutmazsa da betik 0 koduyla sürer (bkz. screenlock.SCRIPT).
SCRIPT = r"""
snd_uid=
for s in $(loginctl list-sessions --no-legend 2>/dev/null | awk '$4 == "seat0" {print $1}'); do
  i=$(loginctl show-session "$s" -p Active -p Class -p User -p Name 2>/dev/null)
  case "$i" in *Class=user*) ;; *) continue ;; esac
  case "$i" in *Name=lightdm*) continue ;; esac
  u=$(printf '%s\n' "$i" | sed -n 's/^User=//p')
  [ -n "$snd_uid" ] || snd_uid=$u
  case "$i" in *Active=yes*) snd_uid=$u; break ;; esac
done
if [ -n "$snd_uid" ] && [ -S "/run/user/$snd_uid/pulse/native" ] && command -v pactl >/dev/null 2>&1; then
  snd_s=$(PULSE_SERVER="unix:/run/user/$snd_uid/pulse/native" timeout 3 pactl get-default-sink 2>/dev/null)
  case "$snd_s" in ''|auto_null) ;; *)
    echo "A $(PULSE_SERVER="unix:/run/user/$snd_uid/pulse/native" timeout 3 pactl get-sink-mute "$snd_s" 2>/dev/null | awk '{print $2}') $(PULSE_SERVER="unix:/run/user/$snd_uid/pulse/native" timeout 3 pactl get-sink-volume "$snd_s" 2>/dev/null | grep -o '[0-9]*%' | head -n 1 | tr -d %)" ;;
  esac
fi
if [ -s /var/lib/ankamon-sound-limit/limit ] && [ -e /etc/systemd/system/ankamon-sound-limit.service ]; then
  echo "AL $(head -c 4 /var/lib/ankamon-sound-limit/limit)"
fi
"""


def parse(output: str) -> dict | None:
    """Betik çıktısındaki "A" (sessiz mi, düzey) ve "AL" (sınır) satırlarından {"muted": bool|None, "volume": int|None,
    "limit": int|None}; hiçbiri okunamadıysa None (bilinmiyor)."""
    muted = volume = limit = None
    for line in output.splitlines():
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "AL" and len(parts) > 1 and parts[1].isdigit():
            limit = max(0, min(int(parts[1]), 100))
        elif parts[0] == "A":
            muted = {"yes": True, "no": False}.get(parts[1]) if len(parts) > 1 else None
            volume = next((int(p) for p in parts[1:] if p.isdigit()), None)
            if volume is not None:
                volume = max(0, min(volume, 1000))   # pactl %100'ün üstüne (yükseltme) çıkabilir
    if muted is None and volume is None and limit is None:
        return None
    return {"muted": muted, "volume": volume, "limit": limit}
