"""TiHA'nın geri sayımlı otomatik kapatması (m11) için kalan süre.

TiHA, Pardus eta-shutdown'ın servis dosyasını kendi sürümüyle değiştirir ("TiHA Enhanced Eta Shutdown"):
servis dakikada bir X boşta kalma süresini (xidle, tüm ekranlardan en büyüğü) okur; [TIMED_MODE] eşiği
(hour*3600 + minute*60, en az 60 sn) aşılınca ekranı uyandırıp tiha-shutdown-countdown.py penceresini
COUNTDOWN_SECONDS süreyle açar, süre bitince kapatır ("10 dakika ertele" dışarıdan okunamaz). [AUTO_SHUTDOWN]
sabit saatte pencere hedeften COUNTDOWN_SECONDS önce açılır. Monitörün DPMS ile kapanması boşta kalma
sayacını sıfırlamaz — bu yüzden güç tasarrufundaki ekranda kalan süre anlamlıdır (Ekranlar önizlemesi).
Paket güncellemesi TiHA dosyasının üzerine yazabildiğinden her yoklamada yeniden denetlenir.

Betik oturum yoklamasının SSH turuna eklenir (bkz. session_probe._SCRIPT); tek satır üretir:
  SD active=<0|1> tiha=<0|1> kind=<none|idle|clock|dialog> phase=<off|idle|due|clock|countdown>
     idle=<sn> countdown=<sn> remaining=<sn>
remaining: pencerenin açılmasına kalan süre (phase=countdown'da açık pencerenin kapatmaya kalan süresi).
"""

from __future__ import annotations

import time

# pgrep deseninde [.]: yoklamanın kendi "sh -c" komut satırıyla eşleşmesin.
SCRIPT = r"""
C=/etc/pardus/eta-shutdown.conf; SD=/usr/share/eta/eta-shutdown/src/service
ini() { awk -F' *= *' -v s="[$1]" -v k="$2" '/^\[/{c=($0==s);next} c&&$1==k{print $2;exit}' "$C" 2>/dev/null; }
mode=$(ini TIMED_MODE mode); th=$(ini TIMED_MODE hour); tm=$(ini TIMED_MODE minute)
ae=$(ini AUTO_SHUTDOWN enabled); ah=$(ini AUTO_SHUTDOWN hour); am=$(ini AUTO_SHUTDOWN minute)
act=0; systemctl -q is-active eta-shutdown 2>/dev/null && act=1
tiha=0; cd=0; minreq=300
if grep -q 'TiHA Enhanced' "$SD/service.py" 2>/dev/null; then
  tiha=1; minreq=60; cd=$(awk '/^COUNTDOWN_SECONDS *=/{print $3+0;exit}' "$SD/service.py")
fi
now=$(date +%s); idle=; rem=; phase=off; kind=none
cpid=$(pgrep -of 'tiha-shutdown-countdown[.]py' 2>/dev/null)
if [ "$act" = 1 ] && [ -n "$cpid" ]; then
  et=$(ps -o etimes= -p "$cpid" | tr -d ' ')
  phase=countdown; kind=dialog; rem=$((cd - ${et:-0})); [ "$rem" -lt 0 ] && rem=0
elif [ "$act" = 1 ]; then
  if [ -n "$mode" ] && [ "$mode" != none ]; then
    kind=idle
    idle=$(python3 -c 'import sys;sys.path.insert(0,sys.argv[1])
from xidle import get_idle_time
m=-1
for d in (":0",":1",":10",":11"):
    try:
        i=get_idle_time(d)
    except Exception: continue
    if i>0 and i>m: m=i
print(m//1000 if m>0 else "")' "$SD" 2>/dev/null)
    req=$(( ${th:-0}*3600 + ${tm:-0}*60 )); [ "$req" -lt "$minreq" ] && req=$minreq
    if [ -n "$idle" ]; then
      rem=$((req - idle)); if [ "$rem" -lt 0 ]; then phase=due; rem=0; else phase=idle; fi
    fi
  fi
  ae=$(echo "$ae" | tr A-Z a-z)
  if [ "$ae" = true ]; then
    tgt=$(date -d "$(printf %02d:%02d "${ah:-0}" "${am:-0}")" +%s)
    st=$(date -d "$(systemctl show eta-shutdown -p ActiveEnterTimestamp --value)" +%s 2>/dev/null)
    if [ "$now" -lt "$tgt" ] && [ "${st:-0}" -lt "$tgt" ]; then
      r=$((tgt - cd - now)); [ "$r" -lt 0 ] && r=0
      if [ -z "$rem" ] || [ "$r" -lt "$rem" ]; then rem=$r; kind=clock; phase=clock; fi
    fi
  fi
fi
echo "SD active=$act tiha=$tiha kind=$kind phase=$phase idle=$idle countdown=$cd remaining=$rem"
"""


def parse(output: str) -> dict | None:
    """"SD …" satırından durum; geri sayım uygulanmıyorsa (servis kapalı, TiHA sürümü değil, kip yok) None.

    Döner: {"phase", "kind", "countdown": sn, "dialog_at": epoch ms | None (pencerenin açılacağı an),
    "off_at": epoch ms | None (kapatma anı)} — anlar yoklama anına göre hesaplanır, tarayıcı geri sayar."""
    line = next((l for l in output.splitlines() if l.startswith("SD ")), None)
    if not line:
        return None
    f = dict(kv.split("=", 1) for kv in line[3:].split() if "=" in kv)
    if f.get("active") != "1" or f.get("tiha") != "1" or f.get("kind") in (None, "none"):
        return None
    num = lambda k: int(f[k]) if f.get(k, "").lstrip("-").isdigit() else None
    remaining, countdown = num("remaining"), num("countdown") or 0
    now_ms = int(time.time() * 1000)
    if remaining is None:
        return {"phase": "unknown", "kind": f["kind"], "countdown": countdown, "dialog_at": None, "off_at": None}
    if f["phase"] == "countdown":
        return {"phase": "countdown", "kind": f["kind"], "countdown": countdown, "dialog_at": None,
                "off_at": now_ms + remaining * 1000}
    return {"phase": f["phase"], "kind": f["kind"], "countdown": countdown,
            "dialog_at": now_ms + remaining * 1000, "off_at": now_ms + (remaining + countdown) * 1000}
