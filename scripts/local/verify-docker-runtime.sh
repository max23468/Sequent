#!/usr/bin/env bash
set -euo pipefail

image="${SEQUENT_IMAGE:-sequent:local}"

[[ "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" == linux/arm64 ]] \
  || { echo "L'immagine Sequent non è linux/arm64" >&2; exit 1; }

docker run --rm --platform linux/arm64 --entrypoint /bin/sh "$image" -c '
set -eu
test "$(id -u)" = 10001
test "$(id -g)" = 10001
grep -Fx "VERSION_ID=\"13\"" /etc/os-release >/dev/null
grep -Fx "VERSION_CODENAME=trixie" /etc/os-release >/dev/null
test ! -e /etc/alpine-release
! command -v apk >/dev/null 2>&1
ldd --version 2>&1 | head -n 1 | grep -E "GLIBC|GNU libc" >/dev/null
test -z "$(find /lib /usr/lib -iname "*musl*" -print -quit 2>/dev/null)"
! dpkg-query -W gcompat >/dev/null 2>&1
test "$(node --version)" = v26.7.0
test "$(npm --version)" = 12.0.2
for script in backup connect-codex qualify-codex-runtime qualify-diz-corpus repair-diz-acquisitions reset-owner restore seed-synthetic; do
  test -r "/app/scripts/admin/$script.ts"
done
for tool in file gs jbig2 libreoffice magick ocrmypdf openssl pdftoppm pngquant \
  python3 qpdf tesseract unpaper unzip; do
  command -v "$tool" >/dev/null
done
tesseract --list-langs 2>/dev/null | grep -Fx ita >/dev/null
for tool in cc c++ gcc g++ ld make; do
  ! command -v "$tool" >/dev/null 2>&1
done
test -z "$(find /app/node_modules/@openai -writable -print -quit)"
bwrap_path="$(find /app/node_modules/@openai -type f -name bwrap -print -quit)"
test -n "$bwrap_path"
test -x "$bwrap_path"
printf "runtime_packages=%s\n" "$(dpkg-query -W | wc -l | tr -d " ")"
'

docker run --rm --platform linux/arm64 --user 0:0 --entrypoint /bin/sh "$image" -c '
set -eu
test -z "$(getcap -r / 2>/dev/null)"
setid_files="$(find / -xdev -type f -perm /6000 -print 2>/dev/null)"
test -z "$setid_files"
'

printf 'Runtime Docker qualificato: immagine=%s piattaforma=linux/arm64 utente=10001:10001\n' \
  "$image"
