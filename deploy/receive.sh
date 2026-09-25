#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# qkenn-site-receive — nhận bản build site tĩnh qkenn.cloud, đổi phiên bản NGUYÊN TỬ.
#
# Cài (bản chạy thật là BẢN SAO root sở hữu, không chạy thẳng từ repo — xem README):
#   install -o root -g root -m 0755 deploy/receive.sh /usr/local/bin/qkenn-site-receive
# Gọi: SSH forced command của khoá github-actions-site-deploy:
#   restrict,command="/usr/local/bin/qkenn-site-receive" ssh-ed25519 AAAA… github-actions-site-deploy
# Lệnh lấy từ SSH_ORIGINAL_COMMAND; root chạy tay trên VPS thì truyền làm tham số.
#
# Lệnh (khớp CHÍNH XÁC, mọi thứ khác bị từ chối):
#   deploy <sha40>                          stdin = tar.gz nội dung dist/ → release mới → current
#   rollback <id|sha40|previous|initial>    trỏ current về một release đã có
#   list                                    liệt kê release
#
# Bố cục $SITE_ROOT (mặc định /var/www/qkenn.cloud):
#   releases/<YYYYmmddTHHMMSSZ>-<sha40>/   mỗi lần build 1 thư mục. CMS publish build lại CÙNG
#                                          commit nhưng nội dung khác → tên không thể chỉ là sha.
#   current  -> releases/<id>              nginx root
#   previous -> releases/<id>              bản ngay trước; nginx lấy /_astro/* cũ từ đây
#
# Nguyên tử: mọi bước trước `mv -T current.new current` KHÔNG đụng bản đang phục vụ, và
# rename(2) là nguyên tử → khách luôn thấy bản cũ ĐẦY ĐỦ hoặc bản mới ĐẦY ĐỦ.
# Client (GitHub Actions) đứt giữa chừng: upload thiếu → gzip lỗi → bỏ, site không đổi;
# đã nhận đủ → chạy nốt tới cùng (bỏ qua HUP/PIPE, output ghi lỗi thì lờ đi).
# tar LUÔN đọc archive từ stdin (`-f - <file`), không bao giờ từ đường dẫn file: với đường dẫn,
# GNU tar tự nhận và giải nén xz/bzip2/zstd/gzip… → archive nén lồng lách được MAX_UNPACKED_MB.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
export LC_ALL=C
unset TAR_OPTIONS # không cho môi trường chèn tuỳ chọn tar (vd --use-compress-program)
umask 022
trap '' HUP PIPE

SITE_ROOT=/var/www/qkenn.cloud
LOG_FILE=/var/log/qkenn-site-deploy.log
KEEP=5                 # số release mới nhất giữ lại (+ luôn giữ current và previous)
MAX_UPLOAD_MB=200      # tar.gz nhận qua stdin
MAX_UNPACKED_MB=1024   # giới hạn cả luồng tar sau gunzip LẪN tổng kích thước file khai trong archive
                       # (chặn gzip bomb, nén lồng, file sparse khai khống)
MAX_ENTRIES=50000      # số mục trong archive
UPLOAD_TIMEOUT=300     # giây chờ nhận xong stdin
LOCK_WAIT=120          # giây chờ deploy/rollback khác xong

# Override CHỈ dành cho test cục bộ (deploy/test-receive.sh). Chạy qua SSH (có SSH_CONNECTION)
# thì luôn dùng giá trị cố định ở trên — client không thể đổi thư mục đích.
if [ -z "${SSH_CONNECTION:-}" ]; then
  SITE_ROOT="${QKENN_SITE_ROOT:-$SITE_ROOT}"
  LOG_FILE="${QKENN_SITE_LOG:-$LOG_FILE}"
  MAX_UPLOAD_MB="${QKENN_SITE_MAX_UPLOAD_MB:-$MAX_UPLOAD_MB}"
  MAX_UNPACKED_MB="${QKENN_SITE_MAX_UNPACKED_MB:-$MAX_UNPACKED_MB}"
  LOCK_WAIT="${QKENN_SITE_LOCK_WAIT:-$LOCK_WAIT}"
fi

REL_DIR="$SITE_ROOT/releases"
CURRENT="$SITE_ROOT/current"
PREVIOUS="$SITE_ROOT/previous"
RE_ID='^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{40}$'
CLIENT="${SSH_CONNECTION:-local}"
CLIENT="${CLIENT%% *}"
WORK=""
STAGE=""

# ── Tiện ích ────────────────────────────────────────────────────────────────
log() {
  printf '%s\n' "$*" 2>/dev/null || true
  printf '%s [%s %s] %s\n' "$(date -u +%FT%TZ)" "$$" "$CLIENT" "$*" >>"$LOG_FILE" 2>/dev/null || true
}

die() {
  printf '✗ LỖI: %s\n' "$*" >&2 2>/dev/null || true
  printf '%s [%s %s] ✗ LỖI: %s\n' "$(date -u +%FT%TZ)" "$$" "$CLIENT" "$*" >>"$LOG_FILE" 2>/dev/null || true
  exit 1
}

cleanup() {
  if [ -n "$STAGE" ] && [ -d "$STAGE" ]; then rm -rf -- "$STAGE"; fi
  if [ -n "$WORK" ] && [ -d "$WORK" ]; then rm -rf -- "$WORK"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for n in "$MAX_UPLOAD_MB" "$MAX_UNPACKED_MB" "$LOCK_WAIT"; do
  [[ $n =~ ^[0-9]+$ ]] || die "giới hạn không hợp lệ: $n"
done

# Tên release mà symlink đang trỏ tới ("" nếu không có)
link_id() {
  local t
  t="$(readlink -- "$1" 2>/dev/null)" || return 0
  printf '%s' "${t##*/}"
}

acquire_lock() {
  mkdir -p -- "$REL_DIR"
  exec 9>>"$SITE_ROOT/.deploy.lock"
  if ! flock -w "$LOCK_WAIT" 9; then
    die "đang có deploy/rollback khác chạy — chờ ${LOCK_WAIT}s vẫn chưa lấy được khoá"
  fi
}

check_layout() {
  if [ -e "$CURRENT" ] && [ ! -L "$CURRENT" ]; then
    die "$CURRENT tồn tại nhưng không phải symlink — làm bước chuyển đổi một lần trong deploy/README.md trước"
  fi
}

# Dọn rác của lần chạy bị kill -9 (chỉ gọi khi đang giữ khoá)
cleanup_stale() {
  find "$REL_DIR" -mindepth 1 -maxdepth 1 \( -name '*.tmp' -o -name '*.del' \) -exec rm -rf -- {} +
  find "$SITE_ROOT" -mindepth 1 -maxdepth 1 -name '.work.*' -exec rm -rf -- {} +
  rm -f -- "$SITE_ROOT/current.new" "$SITE_ROOT/previous.new"
}

# Đổi current NGUYÊN TỬ (symlink tạm + rename), previous = bản vừa bị thay
switch_to() {
  local id="$1" old
  old="$(link_id "$CURRENT")"
  ln -sfn -- "releases/$id" "$SITE_ROOT/current.new"
  mv -Tf -- "$SITE_ROOT/current.new" "$CURRENT"
  if [ -n "$old" ] && [ "$old" != "$id" ] && [ -d "$REL_DIR/$old" ]; then
    ln -sfn -- "releases/$old" "$SITE_ROOT/previous.new"
    mv -Tf -- "$SITE_ROOT/previous.new" "$PREVIOUS"
  fi
}

# Giữ KEEP release mới nhất; không bao giờ xoá bản current/previous đang trỏ tới
prune() {
  local cur prev r i=0
  local -a all=()
  cur="$(link_id "$CURRENT")"
  prev="$(link_id "$PREVIOUS")"
  mapfile -t all < <(find "$REL_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | grep -E "$RE_ID" | sort -r)
  for r in "${all[@]}"; do
    i=$((i + 1))
    if [ "$i" -le "$KEEP" ] || [ "$r" = "$cur" ] || [ "$r" = "$prev" ]; then continue; fi
    # Đổi tên trước khi xoá: bị ngắt giữa chừng thì chỉ còn *.del (dọn lần sau),
    # không bao giờ còn một release "dở dang" có thể bị rollback nhầm.
    mv -T -- "$REL_DIR/$r" "$REL_DIR/$r.del"
    rm -rf -- "$REL_DIR/$r.del"
    log "  - đã xoá release cũ $r"
  done
}

# ── deploy <sha40> ──────────────────────────────────────────────────────────
cmd_deploy() {
  local sha="$1" id rc=0 up_size un_size n bad cur files size total
  local -a ps=()
  local max_up=$((MAX_UPLOAD_MB * 1024 * 1024))
  local max_un=$((MAX_UNPACKED_MB * 1024 * 1024))

  if [ -t 0 ]; then die "stdin phải là tar.gz — vd: tar -C dist -czf - . | ssh … \"deploy <sha>\""; fi
  acquire_lock
  check_layout
  cleanup_stale

  # Tên release phải tăng dần theo thời gian (prune sắp theo tên): nếu cùng giây với bản mới nhất
  # thì chờ sang giây sau (tối đa 3s, phòng đồng hồ bị lùi); cuối cùng vẫn bảo đảm không trùng tên.
  local newest ts tries=0
  newest="$(find "$REL_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | grep -E "$RE_ID" | sort | tail -n 1 || true)"
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  while { [ -n "$newest" ] && [[ ! $ts > ${newest%%-*} ]] && [ "$tries" -lt 3 ]; } ||
    [ -e "$REL_DIR/$ts-$sha" ]; do
    sleep 1
    tries=$((tries + 1))
    ts="$(date -u +%Y%m%dT%H%M%SZ)"
  done
  id="$ts-$sha"
  WORK="$(mktemp -d -- "$SITE_ROOT/.work.XXXXXX")"
  STAGE="$REL_DIR/$id.tmp"
  mkdir -- "$STAGE"
  log "→ deploy ${sha:0:12} → release $id"

  # 1. Nhận archive (giới hạn dung lượng + thời gian)
  timeout "$UPLOAD_TIMEOUT" head -c "$((max_up + 1))" >"$WORK/upload.tar.gz" || rc=$?
  if [ "$rc" -eq 124 ]; then die "quá ${UPLOAD_TIMEOUT}s vẫn chưa nhận xong dữ liệu"; fi
  if [ "$rc" -ne 0 ]; then die "đọc stdin lỗi (rc=$rc)"; fi
  up_size="$(stat -c %s -- "$WORK/upload.tar.gz")"
  if [ "$up_size" -eq 0 ]; then die "stdin rỗng — không nhận được archive"; fi
  if [ "$up_size" -gt "$max_up" ]; then die "archive vượt giới hạn ${MAX_UPLOAD_MB} MB"; fi

  # 2. Giải nén gzip có giới hạn (chặn gzip bomb); upload bị cắt → gzip báo lỗi
  set +e
  gzip -dc -- "$WORK/upload.tar.gz" 2>"$WORK/gzip.err" | head -c "$((max_un + 1))" >"$WORK/upload.tar"
  ps=("${PIPESTATUS[@]}")
  set -e
  un_size="$(stat -c %s -- "$WORK/upload.tar")"
  if [ "$un_size" -gt "$max_un" ]; then die "nội dung giải nén vượt ${MAX_UNPACKED_MB} MB — từ chối"; fi
  if [ "${ps[0]}" -ne 0 ]; then
    die "archive gzip hỏng hoặc thiếu (upload bị cắt?): $(head -c 200 "$WORK/gzip.err" | tr '\n' ' ')"
  fi
  if [ "${ps[1]}" -ne 0 ]; then die "không ghi được file tạm (đầy đĩa?)"; fi

  # 3. Kiểm tra TỪNG mục trước khi giải nén: chỉ file/thư mục thường, không '/…', không '..'
  #    tar đọc từ STDIN: gặp archive nén (gzip bọc tar.xz/.bz2/.zst/.gz…) tar KHÔNG tự giải nén
  #    mà báo "Archive is compressed" → từ chối (đọc từ đường dẫn file thì tar tự giải nén lớp trong).
  if ! tar -tvf - --numeric-owner <"$WORK/upload.tar" >"$WORK/list.v" 2>"$WORK/tar.err" ||
    ! tar -tf - <"$WORK/upload.tar" >"$WORK/list.n" 2>>"$WORK/tar.err"; then
    if grep -q 'Archive is compressed' "$WORK/tar.err"; then
      die "archive nén lồng (trong gzip lại là xz/bzip2/zstd/gzip…) — chỉ nhận tar.gz một lớp — từ chối"
    fi
    die "tar không đọc được: $(head -c 200 "$WORK/tar.err" | tr '\n' ' ')"
  fi
  n="$(wc -l <"$WORK/list.n")"
  if [ "$n" -eq 0 ]; then die "archive rỗng"; fi
  if [ "$n" -gt "$MAX_ENTRIES" ]; then die "archive có $n mục (> $MAX_ENTRIES) — từ chối"; fi
  bad="$(grep -v '^[-d]' "$WORK/list.v" | head -n 3 | tr -s ' \n' ' ' || true)"
  if [ -n "$bad" ]; then
    die "archive chứa mục không phải file/thư mục thường (symlink/hardlink/thiết bị…) — từ chối: $bad"
  fi
  bad="$(grep -E '^/|(^|/)\.\.(/|$)' "$WORK/list.n" | head -n 3 | tr '\n' ' ' || true)"
  if [ -n "$bad" ]; then die "archive có đường dẫn tuyệt đối hoặc '..' — từ chối: $bad"; fi
  # Tổng kích thước khai báo (cột 3 của `tar -tv`; file sparse = kích thước THẬT sau giải nén):
  # luồng tar nhỏ vẫn có thể bung ra rất lớn (file sparse) → so với MAX_UNPACKED_MB trước khi giải nén
  total="$(awk -v max="$max_un" '$3 !~ /^[0-9]+$/ { bad = 1 } { s += $3 }
    END { if (bad) print "bad"; else if (s > max + 0) print "over"; else print "ok" }' "$WORK/list.v")"
  if [ "$total" = bad ]; then die "không đọc được kích thước mục trong archive — từ chối"; fi
  if [ "$total" != ok ]; then die "tổng kích thước file trong archive vượt ${MAX_UNPACKED_MB} MB — từ chối"; fi

  # 4. Giải nén vào thư mục tạm (không giữ owner/quyền từ archive), tar đọc từ stdin như bước 3
  if ! tar -xf - -C "$STAGE" --no-same-owner --no-same-permissions \
    --no-overwrite-dir <"$WORK/upload.tar" 2>"$WORK/tar.err"; then
    die "giải nén lỗi: $(head -c 200 "$WORK/tar.err" | tr '\n' ' ')"
  fi
  # Chốt chặn cuối: đo thật trên đĩa (kích thước biểu kiến) sau giải nén
  un_size="$(du -sb -- "$STAGE" | cut -f1)"
  if [ "$un_size" -gt "$max_un" ]; then die "bản build sau giải nén vượt ${MAX_UNPACKED_MB} MB — từ chối"; fi
  if [ ! -f "$STAGE/index.html" ] || [ -L "$STAGE/index.html" ]; then
    die "bản build thiếu index.html ở gốc — từ chối"
  fi
  if [ ! -f "$STAGE/404.html" ]; then log "  ⚠ thiếu 404.html — nginx sẽ trả trang 404 mặc định"; fi

  # Chỉ đọc cho nginx (www-data): root sở hữu, thư mục 755, file 644
  if [ "$(id -u)" -eq 0 ]; then chown -R 0:0 -- "$STAGE"; fi
  find "$STAGE" -type d -exec chmod 0755 -- {} +
  find "$STAGE" -type f -exec chmod 0644 -- {} +

  # 5. Nội dung y hệt bản đang chạy (vd CMS lưu mà không đổi gì public) → giữ nguyên
  cur="$(link_id "$CURRENT")"
  if [ -n "$cur" ] && [ -d "$REL_DIR/$cur" ] && diff -rq -- "$REL_DIR/$cur" "$STAGE" >/dev/null 2>&1; then
    log "= nội dung giống hệt bản đang chạy ($cur) — giữ nguyên, không tạo release mới"
    log "RESULT=unchanged RELEASE=$cur"
    return 0
  fi

  # 6. Chốt release rồi đổi current NGUYÊN TỬ
  mv -T -- "$STAGE" "$REL_DIR/$id"
  STAGE=""
  sync
  switch_to "$id"
  files="$(find "$REL_DIR/$id" -type f | wc -l)"
  size="$(du -sh -- "$REL_DIR/$id" | cut -f1)"
  log "✓ DEPLOY OK: current -> releases/$id ($files file, $size)"
  prune
  log "RESULT=deployed RELEASE=$id"
}

# ── rollback <id|sha40|previous|initial> ────────────────────────────────────
cmd_rollback() {
  local want="$1" id=""
  acquire_lock
  check_layout
  case "$want" in
    previous)
      id="$(link_id "$PREVIOUS")"
      if [ -z "$id" ]; then die "chưa có bản previous để quay về"; fi
      ;;
    initial) id=initial ;;
    *)
      if [[ $want =~ ^[0-9a-f]{40}$ ]]; then
        id="$(find "$REL_DIR" -mindepth 1 -maxdepth 1 -type d -name "*-$want" -printf '%f\n' |
          grep -E "$RE_ID" | sort -r | head -n 1 || true)"
        if [ -z "$id" ]; then die "không còn release nào của commit ${want:0:12} (xem: list)"; fi
      else
        id="$want"
      fi
      ;;
  esac
  if [ ! -d "$REL_DIR/$id" ] || [ -L "$REL_DIR/$id" ] || [ ! -f "$REL_DIR/$id/index.html" ]; then
    die "release '$id' không tồn tại hoặc thiếu index.html (xem: list)"
  fi
  if [ "$(link_id "$CURRENT")" = "$id" ]; then
    log "= current đã là $id — không đổi"
    log "RESULT=unchanged RELEASE=$id"
    return 0
  fi
  log "→ rollback → release $id"
  switch_to "$id"
  log "✓ ROLLBACK OK: current -> releases/$id"
  log "RESULT=rolled-back RELEASE=$id"
}

# ── list ────────────────────────────────────────────────────────────────────
cmd_list() {
  local cur prev r mark
  cur="$(link_id "$CURRENT")"
  prev="$(link_id "$PREVIOUS")"
  printf 'SITE_ROOT=%s\n' "$SITE_ROOT" 2>/dev/null || true
  if [ ! -d "$REL_DIR" ]; then
    printf '(chưa có thư mục releases)\n' 2>/dev/null || true
    return 0
  fi
  while IFS= read -r r; do
    mark=""
    if [ "$r" = "$cur" ]; then mark="  <- current"; fi
    if [ "$r" = "$prev" ]; then mark="$mark  <- previous"; fi
    printf '%s%s\n' "$r" "$mark" 2>/dev/null || true
  done < <(find "$REL_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | grep -Ev '\.(tmp|del)$' | sort -r)
}

# ── Phân tích lệnh (khớp chính xác, không bao giờ eval) ─────────────────────
CMD_LINE="${SSH_ORIGINAL_COMMAND-$*}"
re_deploy='^deploy ([0-9a-f]{40})$'
re_rollback='^rollback ([0-9]{8}T[0-9]{6}Z-[0-9a-f]{40}|[0-9a-f]{40}|previous|initial)$'

if [ "${#CMD_LINE}" -gt 120 ]; then
  die "lệnh bị từ chối (quá dài)"
elif [[ $CMD_LINE =~ $re_deploy ]]; then
  cmd_deploy "${BASH_REMATCH[1]}"
elif [[ $CMD_LINE =~ $re_rollback ]]; then
  cmd_rollback "${BASH_REMATCH[1]}"
elif [ "$CMD_LINE" = "list" ]; then
  cmd_list
else
  die "lệnh bị từ chối: $(printf '%q' "$CMD_LINE") — chỉ nhận: deploy <sha40> | rollback <id|sha40|previous|initial> | list"
fi
