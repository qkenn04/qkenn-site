#!/usr/bin/env bash
# Test end-to-end deploy/receive.sh trên THƯ MỤC TẠM (không đụng /var/www, /var/log).
# Chạy: bash deploy/test-receive.sh      (cần bash, GNU tar/coreutils, flock, python3, xz, bzip2; zstd nếu có)
# CI chạy file này trong job build; sửa receive.sh thì chạy lại trước khi cài lên VPS.
# SC2016: điều kiện kiểm tra cố ý để trong '…' cho eval đánh giá SAU khi chạy lệnh.
# SC2034: E/F/G/H được đọc gián tiếp qua eval.
# shellcheck disable=SC2016,SC2034
set -euo pipefail
export LC_ALL=C
unset SSH_CONNECTION SSH_CLIENT SSH_ORIGINAL_COMMAND

HERE="$(cd "$(dirname "$0")" && pwd)"
RECV="$HERE/receive.sh"
T="$(mktemp -d)"
trap 'rm -rf -- "$T"' EXIT
export QKENN_SITE_LOG="$T/deploy.log"
export QKENN_SITE_ROOT="$T/site"
ROOT="$QKENN_SITE_ROOT"

PASS=0
FAIL=0
RC=0
OUT=""
ok() { PASS=$((PASS + 1)); printf '  ✓ %s\n' "$1"; }
ko() { FAIL=$((FAIL + 1)); printf '  ✗ %s\n' "$1"; printf '      rc=%s out: %s\n' "$RC" "$(printf '%s' "$OUT" | tail -n 3 | tr '\n' '|')"; }
check() { local d="$1"; shift; if "$@"; then ok "$d"; else ko "$d"; fi; }
section() { printf '\n== %s\n' "$1"; }

sha() { printf '%040x' "$1"; }
# Chạy receive như SSH forced command: $1 = SSH_ORIGINAL_COMMAND, stdin = archive
run() { RC=0; SSH_ORIGINAL_COMMAND="$1" bash "$RECV" >"$T/out" 2>&1 || RC=$?; OUT="$(cat "$T/out")"; }
has() { grep -qF -- "$1" <<<"$OUT"; }
rejected() { [ "$RC" -ne 0 ] && has "$1"; }
cur_id() { local t; t="$(readlink "$ROOT/current")"; printf '%s' "${t##*/}"; }
prev_id() { local t; t="$(readlink "$ROOT/previous" 2>/dev/null || true)"; printf '%s' "${t##*/}"; }
cur_is() { [ "$(cat "$ROOT/current/index.html" 2>/dev/null)" = "<h1>$1</h1>" ]; }
nrel() { find "$ROOT/releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | grep -cE '^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{40}$' || true; }
no_leftovers() { [ -z "$(find "$ROOT" -maxdepth 2 \( -name '*.tmp' -o -name '*.del' -o -name '.work.*' -o -name '*.new' \) -print -quit)" ]; }

mksite() { # $1 = tên (marker)
  local d="$T/src/$1"
  mkdir -p "$d/en" "$d/_astro" "$d/blog/xin-chao"
  printf '<h1>%s</h1>' "$1" >"$d/index.html"
  printf '404 %s' "$1" >"$d/404.html"
  printf 'en %s' "$1" >"$d/en/index.html"
  printf 'post %s' "$1" >"$d/blog/xin-chao/index.html"
  printf 'body{--m:"%s"}' "$1" >"$d/_astro/app.$1.css"
  chmod 0600 "$d/index.html"  # quyền lạ từ CI → receive phải chuẩn hoá về 0644
  tar -C "$d" -czf "$T/$1.tgz" .
}

evil() { # $1 = loại, $2 = file ra — archive độc hại (vẫn có index.html hợp lệ)
  python3 - "$1" "$2" "$T" <<'PY'
import io, sys, tarfile
kind, out, tmp = sys.argv[1:4]
def f(t, name, data=b"pwned"):
    ti = tarfile.TarInfo(name); ti.size = len(data); t.addfile(ti, io.BytesIO(data))
def special(t, name, typ, link=""):
    ti = tarfile.TarInfo(name); ti.type = typ; ti.linkname = link; t.addfile(ti)
with tarfile.open(out, "w:gz", format=tarfile.GNU_FORMAT) as t:
    f(t, "./index.html", b"<h1>evil</h1>")
    if kind == "dotdot":   f(t, "../evil.txt")
    elif kind == "nested": f(t, "./a/../../evil.txt")
    elif kind == "abs":    f(t, tmp + "/abs-evil.txt")
    elif kind == "symlink":
        special(t, "./link", tarfile.SYMTYPE, "/etc"); f(t, "./link/evil.txt")
    elif kind == "hardlink": special(t, "./hl", tarfile.LNKTYPE, "/etc/passwd")
    elif kind == "chardev":  special(t, "./dev", tarfile.CHRTYPE)
    elif kind == "fifo":     special(t, "./fifo", tarfile.FIFOTYPE)
PY
}

# ── Chuẩn bị: bố cục sau bước chuyển đổi một lần (README) ──────────────────
mkdir -p "$ROOT/releases/initial"
printf '<h1>initial</h1>' >"$ROOT/releases/initial/index.html"
ln -s releases/initial "$ROOT/current"
# An toàn: receive.sh bỏ qua QKENN_SITE_ROOT khi có SSH_CONNECTION (vd còn sót trong môi trường)
# → xác nhận bằng lệnh chỉ đọc `list` rằng nó THẬT SỰ dùng thư mục tạm, trước mọi deploy.
if [ "$(SSH_ORIGINAL_COMMAND=list bash "$RECV" 2>&1 | head -n 1)" != "SITE_ROOT=$ROOT" ]; then
  echo "✗ DỪNG: receive.sh không dùng thư mục tạm $ROOT — không chạy test (tránh đụng site thật)" >&2
  exit 1
fi
for s in A B C D E F G H; do mksite "$s"; done
A=$(sha 10) B=$(sha 11) C=$(sha 12) D=$(sha 13) E=$(sha 14) F=$(sha 15) G=$(sha 16) H=$(sha 17)

section "Lệnh sai bị từ chối (không đụng gì)"
bad_cmds=(
  "" "deploy" "deploy abc" "deploy ${A:0:39}" "deploy ${A}0" "deploy $A extra" "deploy $A; rm -rf /"
  "deploy \$(id)" "DEPLOY $A" " deploy $A" "deploy  $A" "deploy ${A^^}x" $'deploy '"$A"$'\n'
  $'deploy '"$A"$'\nlist' "rollback" "rollback ../../etc" "rollback /etc" "rollback releases/initial"
  "rollback previous previous" "list -la" "bash" "sh -c id" "scp -t /tmp" "rsync --server -e.LsfxC . /tmp"
  "git-upload-pack '/root'" "$(printf 'x%.0s' {1..200})"
)
for c in "${bad_cmds[@]}"; do
  run "$c" </dev/null
  check "từ chối: $(printf '%q' "${c:0:50}")" rejected "từ chối"
done
RC=0; env -u SSH_ORIGINAL_COMMAND bash "$RECV" </dev/null >"$T/out" 2>&1 || RC=$?; OUT="$(cat "$T/out")"
check "từ chối: đăng nhập không kèm lệnh (SSH_ORIGINAL_COMMAND unset)" rejected "từ chối"
check "sau các lệnh sai: current vẫn là initial, không tạo release" \
  eval '[ "$(cur_id)" = initial ] && [ "$(nrel)" -eq 0 ] && no_leftovers'

section "deploy A → deploy lại A (idempotent) → deploy B"
run "deploy $A" <"$T/A.tgz"
check "deploy A thành công" eval '[ "$RC" -eq 0 ] && has "RESULT=deployed"'
check "current → release của A, tên <ts>-<sha40>" eval 'cur_is A && [[ $(cur_id) =~ ^[0-9]{8}T[0-9]{6}Z-$A$ ]]'
check "previous → initial" eval '[ "$(prev_id)" = initial ]'
check "đủ file (en/, blog/, _astro/, 404)" eval '[ -f "$ROOT/current/en/index.html" ] && [ -f "$ROOT/current/blog/xin-chao/index.html" ] && [ -f "$ROOT/current/_astro/app.A.css" ] && [ -f "$ROOT/current/404.html" ]'
check "quyền chuẩn hoá: file 644, thư mục 755" eval '[ "$(stat -c %a "$ROOT/current/index.html")" = 644 ] && [ "$(stat -c %a "$ROOT/current/_astro")" = 755 ] && [ -z "$(find "$ROOT/current/" \( -type f ! -perm 0644 \) -o \( -type d ! -perm 0755 \) | head -n1)" ]'
if [ "$(id -u)" -eq 0 ]; then
  check "chủ sở hữu root:root (nginx chỉ đọc)" eval '[ -z "$(find "$ROOT/current/" ! -user 0 -o ! -group 0 | head -n1)" ]'
fi
check "ghi log" eval 'grep -q "DEPLOY OK: current -> releases/.*-$A" "$QKENN_SITE_LOG"'
check "không để lại file tạm" no_leftovers
id_a="$(cur_id)"
run "deploy $A" <"$T/A.tgz"
check "deploy lại A cùng nội dung → unchanged, không thêm release" eval '[ "$RC" -eq 0 ] && has "RESULT=unchanged" && [ "$(nrel)" -eq 1 ] && [ "$(cur_id)" = "$id_a" ]'
run "deploy $B" <"$T/B.tgz"
check "deploy B: current=B, previous=A" eval '[ "$RC" -eq 0 ] && cur_is B && [ "$(prev_id)" = "$id_a" ]'
check "asset cũ của A vẫn lấy được qua previous/_astro" eval '[ -f "$ROOT/previous/_astro/app.A.css" ]'
id_b="$(cur_id)"

section "rollback"
run "rollback $A"
check "rollback <sha A> → current=A, previous=B" eval '[ "$RC" -eq 0 ] && has "RESULT=rolled-back" && cur_is A && [ "$(prev_id)" = "$id_b" ]'
run "rollback previous"
check "rollback previous → current=B" eval '[ "$RC" -eq 0 ] && cur_is B && [ "$(prev_id)" = "$id_a" ]'
run "rollback $id_a"
check "rollback <release-id A> → current=A" eval '[ "$RC" -eq 0 ] && cur_is A'
run "rollback $id_a"
check "rollback về chính bản đang chạy → unchanged" eval '[ "$RC" -eq 0 ] && has "RESULT=unchanged" && cur_is A'
run "rollback initial"
check "rollback initial → placeholder" eval '[ "$RC" -eq 0 ] && cur_is initial'
run "rollback $id_b"
check "rollback <release-id B> → current=B" eval '[ "$RC" -eq 0 ] && cur_is B'
run "rollback $(sha 999)"
check "rollback sha không có release → lỗi, current giữ B" eval 'rejected "không còn release" && cur_is B'
run "rollback 20990101T000000Z-$A"
check "rollback id không tồn tại → lỗi, current giữ B" eval 'rejected "không tồn tại" && cur_is B'

section "Archive độc hại / hỏng bị từ chối, site không đổi"
for k in dotdot nested abs symlink hardlink chardev fifo; do
  evil "$k" "$T/evil-$k.tgz"
  run "deploy $C" <"$T/evil-$k.tgz"
  check "từ chối archive $k" eval '[ "$RC" -ne 0 ] && has "từ chối" && cur_is B'
done
check "không file nào lọt ra ngoài release" eval '[ ! -e "$ROOT/releases/evil.txt" ] && [ ! -e "$ROOT/evil.txt" ] && [ ! -e "$T/abs-evil.txt" ] && [ ! -e "$T/evil.txt" ]'
check "không để lại file tạm" no_leftovers
head -c 300 "$T/C.tgz" >"$T/trunc.tgz"
run "deploy $C" <"$T/trunc.tgz"
check "upload bị cắt (client huỷ giữa chừng) → từ chối" eval 'rejected "gzip hỏng" && cur_is B'
run "deploy $C" </dev/null
check "stdin rỗng → từ chối" eval 'rejected "stdin rỗng" && cur_is B'
head -c 5000 /dev/urandom >"$T/garbage"
run "deploy $C" <"$T/garbage"
check "dữ liệu không phải gzip → từ chối" eval 'rejected "gzip hỏng" && cur_is B'
printf 'not a tar archive at all\n%.0s' {1..40} | gzip >"$T/notar.gz"
run "deploy $C" <"$T/notar.gz"
check "gzip nhưng không phải tar → từ chối" eval 'rejected "tar không đọc được" && cur_is B'
mkdir -p "$T/src/noindex/en" && printf x >"$T/src/noindex/en/index.html" && tar -C "$T/src/noindex" -czf "$T/noindex.tgz" .
run "deploy $C" <"$T/noindex.tgz"
check "thiếu index.html → từ chối" eval 'rejected "thiếu index.html" && cur_is B'
mkdir -p "$T/src/big" && cp -r "$T/src/C/." "$T/src/big/" && head -c $((2 * 1024 * 1024)) /dev/urandom >"$T/src/big/_astro/rand.bin"
tar -C "$T/src/big" -czf "$T/big.tgz" .
RC=0; QKENN_SITE_MAX_UPLOAD_MB=1 SSH_ORIGINAL_COMMAND="deploy $C" bash "$RECV" <"$T/big.tgz" >"$T/out" 2>&1 || RC=$?; OUT="$(cat "$T/out")"
check "upload > giới hạn MB → từ chối" eval 'rejected "vượt giới hạn" && cur_is B'
mkdir -p "$T/src/bomb" && cp -r "$T/src/C/." "$T/src/bomb/" && head -c $((5 * 1024 * 1024)) /dev/zero >"$T/src/bomb/zero.bin"
tar -C "$T/src/bomb" -czf "$T/bomb.tgz" .
RC=0; QKENN_SITE_MAX_UNPACKED_MB=1 SSH_ORIGINAL_COMMAND="deploy $C" bash "$RECV" <"$T/bomb.tgz" >"$T/out" 2>&1 || RC=$?; OUT="$(cat "$T/out")"
check "gzip bomb (giải nén > giới hạn) → từ chối" eval 'rejected "giải nén vượt" && cur_is B'
# Nén lồng: gzip(tar.xz|bz2|zst|gz) — gunzip chỉ ra vài trăm byte (< giới hạn) nhưng GNU tar đọc từ
# ĐƯỜNG DẪN file sẽ tự giải nén lớp trong → 5 MB lọt qua giới hạn 1 MB. Đọc từ stdin → phải từ chối.
for z in xz bzip2 zstd gzip; do
  if ! command -v "$z" >/dev/null 2>&1; then printf '  - bỏ qua gzip(tar.%s): không có lệnh %s\n' "$z" "$z"; continue; fi
  tar -C "$T/src/bomb" -cf - . | "$z" -q -c | gzip -c >"$T/nest-$z.tgz"
  QKENN_SITE_MAX_UNPACKED_MB=1 run "deploy $C" <"$T/nest-$z.tgz"
  check "nén lồng gzip(tar.$z) → từ chối, không tự giải nén lớp trong" eval 'rejected "nén lồng" && cur_is B'
done
# File sparse khai 5 MB: luồng tar sau gunzip chỉ ~10 KB (< giới hạn) → phải bị chặn bởi tổng kích thước
mkdir -p "$T/src/sparse" && cp -r "$T/src/C/." "$T/src/sparse/" && truncate -s 5M "$T/src/sparse/_astro/hole.bin"
tar -C "$T/src/sparse" --sparse -czf "$T/sparse.tgz" .
QKENN_SITE_MAX_UNPACKED_MB=1 run "deploy $C" <"$T/sparse.tgz"
check "file sparse (tổng kích thước > giới hạn, luồng tar nhỏ) → từ chối" eval 'rejected "tổng kích thước" && cur_is B'
QKENN_SITE_MAX_UNPACKED_MB=1 run "deploy $B" <"$T/B.tgz"
check "archive tar.gz thường, nhỏ (cùng giới hạn 1 MB) vẫn được nhận" eval '[ "$RC" -eq 0 ] && has "RESULT=unchanged" && cur_is B'
check "không để lại file tạm" no_leftovers

section "Tiến trình nhận bị kill -9 giữa chừng → site không đổi, lần sau tự dọn"
mkfifo "$T/fifo"
SSH_ORIGINAL_COMMAND="deploy $C" bash "$RECV" <"$T/fifo" >"$T/out.kill" 2>&1 &
kpid=$!
exec 7>"$T/fifo"
head -c 200 "$T/C.tgz" >&7
for _ in $(seq 50); do [ -n "$(find "$ROOT/releases" -maxdepth 1 -name '*.tmp' -print -quit)" ] && break; sleep 0.1; done
kill -9 "$kpid" 2>/dev/null || true
wait "$kpid" 2>/dev/null || true
exec 7>&-
flock -w 10 "$ROOT/.deploy.lock" true
check "sau kill -9: current vẫn là B, còn rác *.tmp/.work" eval 'cur_is B && ! no_leftovers'
run "deploy $C" <"$T/C.tgz"
check "deploy kế tiếp thành công và dọn rác" eval '[ "$RC" -eq 0 ] && cur_is C && no_leftovers'

section "Khoá flock"
flock "$ROOT/.deploy.lock" sleep 4 &
lpid=$!
sleep 0.5
RC=0; QKENN_SITE_LOCK_WAIT=1 SSH_ORIGINAL_COMMAND="deploy $D" bash "$RECV" <"$T/D.tgz" >"$T/out" 2>&1 || RC=$?; OUT="$(cat "$T/out")"
check "đang có deploy khác giữ khoá → từ chối sau LOCK_WAIT, site không đổi" eval 'rejected "khoá" && cur_is C'
RC=0; QKENN_SITE_LOCK_WAIT=1 SSH_ORIGINAL_COMMAND="rollback previous" bash "$RECV" </dev/null >"$T/out" 2>&1 || RC=$?; OUT="$(cat "$T/out")"
check "rollback cũng phải chờ khoá" eval 'rejected "khoá" && cur_is C'
wait "$lpid"
: >"$T/conc.log"
for s in D E F; do
  (
    rc=0
    SSH_ORIGINAL_COMMAND="deploy $(eval echo "\$$s")" bash "$RECV" <"$T/$s.tgz" >"$T/out.$s" 2>&1 || rc=$?
    echo "$s $rc" >>"$T/conc.log"
  ) &
done
wait
check "3 deploy song song đều thành công (chạy lần lượt nhờ flock)" eval '[ "$(grep -c " 0$" "$T/conc.log")" -eq 3 ]'
# Log: mỗi "→ deploy" phải được theo sau bởi "DEPLOY OK" của CHÍNH tiến trình đó (không xen kẽ)
check "không có 2 deploy chạy chồng nhau (log không xen kẽ)" eval '
  tail -n 40 "$QKENN_SITE_LOG" | grep -E "→ deploy|DEPLOY OK" | tail -n 6 |
  awk "{ pid=\$2; if (NR % 2 == 1) { open=pid } else if (pid != open) { bad=1 } } END { exit bad }"'
check "current trỏ tới một release đầy đủ (D, E hoặc F)" eval 'cur_is D || cur_is E || cur_is F'

section "Đổi phiên bản nguyên tử: đọc liên tục trong lúc deploy"
rm -f "$T/stop"
(
  n=0 bad=0 re='^<h1>[A-H]</h1>$'
  while [ ! -e "$T/stop" ]; do
    c="$(cat "$ROOT/current/index.html" 2>/dev/null || true)"
    if [[ $c =~ $re ]]; then n=$((n + 1)); else bad=$((bad + 1)); fi
  done
  echo "$n $bad" >"$T/reader"
) &
rpid=$!
for s in G H G H G H; do run "deploy $(eval echo "\$$s")" <"$T/$s.tgz"; done
: >"$T/stop"
wait "$rpid"
read -r reads badreads <"$T/reader"
check "6 lần đổi bản, $reads lần đọc, $badreads lần đọc lỗi/thiếu (phải = 0)" eval '[ "$reads" -gt 0 ] && [ "$badreads" -eq 0 ] && cur_is H'

section "Giữ 5 release mới nhất, không bao giờ xoá current/previous"
export QKENN_SITE_ROOT="$T/site2"
ROOT="$QKENN_SITE_ROOT"
mkdir -p "$ROOT"
for i in 1 2 3 4 5 6 7; do mksite "P$i"; run "deploy $(sha $((100 + i)))" <"$T/P$i.tgz"; done
check "7 deploy → còn 5 release, current=P7" eval '[ "$(nrel)" -eq 5 ] && cur_is P7'
check "release của P1, P2 đã xoá; P3 còn" eval '! ls "$ROOT/releases" | grep -q -- "-$(sha 101)$" && ! ls "$ROOT/releases" | grep -q -- "-$(sha 102)$" && ls "$ROOT/releases" | grep -q -- "-$(sha 103)$"'
run "rollback $(sha 103)"
check "rollback về P3 (cũ nhất còn lại)" eval '[ "$RC" -eq 0 ] && cur_is P3'
mksite P8
run "deploy $(sha 108)" <"$T/P8.tgz"
check "deploy P8: P3 là previous → được giữ dù ngoài top 5 (6 release)" eval 'cur_is P8 && [ "$(nrel)" -eq 6 ] && [ -f "$ROOT/previous/index.html" ] && [ "$(cat "$ROOT/previous/index.html")" = "<h1>P3</h1>" ]'
mksite P9
run "deploy $(sha 109)" <"$T/P9.tgz"
check "deploy P9: P3 hết được bảo vệ → xoá, còn 5" eval 'cur_is P9 && [ "$(nrel)" -eq 5 ] && no_leftovers'
check "rollback previous sau prune vẫn chạy" eval 'run "rollback previous" && [ "$RC" -eq 0 ] && cur_is P8'

section "Bảo vệ khác"
export QKENN_SITE_ROOT="$T/site3"
ROOT="$QKENN_SITE_ROOT"
mkdir -p "$ROOT/current" && printf '<h1>old</h1>' >"$ROOT/current/index.html"
run "deploy $A" <"$T/A.tgz"
check "current là thư mục thật (chưa chuyển đổi) → từ chối, không đụng" eval 'rejected "không phải symlink" && [ -d "$ROOT/current" ] && [ ! -L "$ROOT/current" ]'
RC=0; OUT="$(SSH_CONNECTION="203.0.113.9 50000 10.0.0.1 22" QKENN_SITE_ROOT="$T/hijack" SSH_ORIGINAL_COMMAND=list bash "$RECV" 2>&1)" || RC=$?
check "qua SSH (có SSH_CONNECTION): bỏ qua override thư mục (lệnh list, chỉ đọc)" eval 'has "SITE_ROOT=/var/www/qkenn.cloud" && [ ! -e "$T/hijack" ]'

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
