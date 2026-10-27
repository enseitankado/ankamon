# SPDX-FileCopyrightText: 2026 Özgür Koca <ozgurkoca@gmail.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

# Güvenlik taraması (bkz. .github/workflows/security-scan.yml) için Trivy. Sürüm digest ile sabit;
# Dependabot (docker, bu dizin) yeni sürümü PR olarak önerir — iş akışına gömülü `docker run` olsaydı göremezdi.
FROM aquasec/trivy:0.75.0@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa
