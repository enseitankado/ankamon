# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Servis çıktı satırlarını sınıflandırır: hangileri "Ankamon logs"a girer, hangi düzeyde.

Yalnız gerçek uyarı/hata ve program hata çıktıları (Python traceback'i, PHP istisnası) alınır; INFO/LOG
düzeyindeki olağan çıktı ve bilinen zararsız gürültü (NOISE) atlanır. Her servisin kendi biçimi var:
Python logging (iki biçim), PHP-FPM, PostgreSQL, Grafana (logfmt), nginx, Telegraf, Go servisleri.
"""

from __future__ import annotations

import re

# Python logging: "2026-10-26 13:11:42,796 WARNING ankamon.netscan: ..." ve "… ankamon.files ERROR ...".
_PY_A = re.compile(r"^\d{4}-\d\d-\d\d[ T][\d:.,]+ (DEBUG|INFO|WARNING|ERROR|CRITICAL) ([\w.]+): (.*)$")
_PY_B = re.compile(r"^\d{4}-\d\d-\d\d[ T][\d:.,]+ ([\w.]+) (DEBUG|INFO|WARNING|ERROR|CRITICAL) (.*)$")
# PHP-FPM (decorate_workers_output = no): "[26-Oct-2026 13:11:42] WARNING: [pool www] ..." ya da "NOTICE: PHP message: ..."
_FPM = re.compile(r"^(?:\[[^\]]+\] )?(NOTICE|WARNING|ERROR|ALERT|EMERG): (.*)$")
# PostgreSQL: "2026-10-26 13:11:42.123 +03 [123] FATAL:  sorry, too many clients already"
_PG = re.compile(r"\[\d+\] (WARNING|ERROR|FATAL|PANIC):\s+(.*)$")
_PG_CONT = re.compile(r"\[\d+\] (DETAIL|HINT|STATEMENT|CONTEXT):\s+(.*)$")
# Grafana (logfmt): logger=… level=error msg="…" error="…"
_LOGFMT_LEVEL = re.compile(r"\blevel=(warn|warning|error|crit|critical|fatal)\b")
_LOGFMT_FIELD = re.compile(r'\b(logger|msg|error|err)=("(?:[^"\\]|\\.)*"|\S+)')
# nginx: "2026/10/26 13:11:42 [error] 123#0: *4 connect() failed …"
_NGINX = re.compile(r"\[(warn|error|crit|alert|emerg)\] \d+#\d+: (?:\*\d+ )?(.*)$")
# Telegraf: "2026-10-26T10:11:42Z E! [inputs.prometheus] …"
_TELEGRAF = re.compile(r"\s(E|W)! (.*)$")
# Go servisleri (MediaMTX, FileBrowser): "[WARN ] …", "ERR …"
_GO = re.compile(r"\[(WARN|ERR|ERROR) ?\]\s*(.*)$")
_ANSI = re.compile(r"\x1b\[[0-9;]*m")

_PY_LEVEL = {"WARNING": "warn", "ERROR": "error", "CRITICAL": "error"}

# Bilinen zararsız gürültü (kaynak, düzenli ifade): kaydedilmez. Yeni bir gürültü görülürse buraya eklenir.
NOISE = [
    # Grafana internete çıkamaz (MEB filtresi / kapalı ağ) ve eklenti/uyarı provisioning dizinleri bilerek yok.
    ("grafana", r"Error downloading plugin manifest keys|Failed to get renderer plugin sources|"
                r"Failed to load external plugins|provisioning files from directory|"
                r"Problem deleting stale short urls|update checker|Failed to check for (?:grafana|plugin) update"),
    # Grafana'nın önbellek/kısa adres tabloları: Postgres'in yazdığı yarış hataları zararsız.
    ("postgres", r'cache_data_pkey|relation "short_url" does not exist'),
    ("mediamtx", r"ffmpeg unavailable"),
    ("filemanager", r"is deprecated|cacheDir only has"),
    ("webssh", r"websocket_ping_timeout"),
    # Windows olmayan cihazlar NetBIOS'a yanıt vermez; ad çözümü zaten başka yollarla denenir.
    ("netscan", r"zaman aşımı: nmblookup"),
    # Görev hataları görev başlığıyla ve traceback'iyle zaten kaydedilir (activity.record); stderr kopyası atlanır.
    ("runner", r"^runner: görev #\d+ hatası"),
    ("worker", r"^executor\.jobs: görev #\d+ hatası"),
]
_NOISE = [(src, re.compile(rx)) for src, rx in NOISE]


def _unquote(value: str) -> str:
    return value[1:-1].replace('\\"', '"') if value.startswith('"') else value


def _short(logger: str) -> str:
    return logger.removeprefix("ankamon.")


def classify(line: str) -> tuple[str, str] | None:
    """(düzey, ileti) ya da None (kaydedilmez). Düzey: "warn" | "error"."""
    line = _ANSI.sub("", line).rstrip()
    if not line.strip():
        return None
    m = _PY_A.match(line)
    if m:
        level = _PY_LEVEL.get(m.group(1))
        return (level, f"{_short(m.group(2))}: {m.group(3)}") if level else None
    m = _PY_B.match(line)
    if m:
        level = _PY_LEVEL.get(m.group(2))
        return (level, f"{_short(m.group(1))}: {m.group(3)}") if level else None
    m = _PG.search(line)
    if m:
        # Postgres ERROR çoğunlukla tek sorgunun hatasıdır (uyarı); FATAL/PANIC bağlantıyı/sunucuyu düşürür.
        return ("error" if m.group(1) in ("FATAL", "PANIC") else "warn", f"{m.group(1)}: {m.group(2)}")
    m = _FPM.match(line)
    if m:
        kind, text = m.groups()
        if kind == "NOTICE":
            # PHP hata/istisna çıktıları NOTICE "PHP message:" olarak gelir; diğer NOTICE'lar olağan (fpm başladı vb.).
            if not text.startswith("PHP message:"):
                return None
            text = text.removeprefix("PHP message:").strip()
            fatal = re.search(r"Fatal|Exception|Error\b|Uncaught", text)
            return ("error" if fatal else "warn", text)
        return ("warn" if kind == "WARNING" else "error", text)
    m = _LOGFMT_LEVEL.search(line)
    if m:
        fields = {k: _unquote(v) for k, v in _LOGFMT_FIELD.findall(line)}
        text = fields.get("msg", line)
        if fields.get("error") or fields.get("err"):
            text += f" — {fields.get('error') or fields.get('err')}"
        if fields.get("logger"):
            text = f"{fields['logger']}: {text}"
        return ("warn" if m.group(1).startswith("warn") else "error", text)
    m = _NGINX.search(line)
    if m:
        return ("warn" if m.group(1) == "warn" else "error", m.group(2))
    m = _TELEGRAF.search(line)
    if m:
        return ("error" if m.group(1) == "E" else "warn", m.group(2))
    m = _GO.search(line)
    if m:
        return ("warn" if m.group(1) == "WARN" else "error", m.group(2))
    if line.startswith("Traceback (most recent call last)"):
        return ("error", "Python hatası (traceback)")
    if re.search(r"\b(FATAL|PANIC|CRITICAL)\b", line):
        return ("error", line.strip())
    return None


def is_continuation(line: str) -> bool:
    """Önceki kaydın devamı mı (traceback gövdesi, Postgres DETAIL/STATEMENT …): ayrıntıya eklenir."""
    return bool(line[:1].isspace() or line.startswith(("Traceback (most recent call last)", "During handling",
                                                        "The above exception")) or _PG_CONT.search(line)
                or re.match(r"^[\w.]+(Error|Exception|Exit|Interrupt)(: |$)", line))


def is_noise(source: str, message: str) -> bool:
    return any(src == source and rx.search(message) for src, rx in _NOISE)


def dedup_key(source: str, level: str, message: str) -> str:
    """Tekrar eden kayıtları birleştirmek için: sayılar, IP'ler ve tırnak içi değerler atılır."""
    text = re.sub(r"\d+(\.\d+)*", "#", message)
    text = re.sub(r'"[^"]{0,80}"', '"…"', text)
    return f"{source}|{level}|{text[:160]}"
