# Deploy qkenn.cloud

Site tĩnh Astro → build trên GitHub Actions → gửi qua SSH tới VPS (213.199.51.252) → đổi phiên bản **nguyên tử**.

```
push main ─┐
CMS publish ├─► Actions: test → build (đọc CMS) → kiểm tra dist → site.tar.gz
chạy tay  ─┘                                              │
                    ssh (khoá github-actions-site-deploy) │ stdin = tar.gz
                                                          ▼
     forced command /usr/local/bin/qkenn-site-receive "deploy <sha>"
       nhận (≤200 MB, ≤300 s) → kiểm tra từng mục → giải nén vào releases/<id>.tmp
       → kiểm tra index.html → chuẩn hoá quyền → mv releases/<id> → current (rename nguyên tử)
                                                          ▼
              nginx root /var/www/qkenn.cloud/current (không cần reload)
```

| File | Vai trò |
|---|---|
| `.github/workflows/deploy.yml` | CI: build + deploy + báo Discord |
| `deploy/receive.sh` | Script nhận phía VPS (cài thành `/usr/local/bin/qkenn-site-receive`) |
| `deploy/test-receive.sh` | Test end-to-end receive.sh trên thư mục tạm (CI chạy mỗi lần build) |
| `deploy/nginx-qkenn.cloud.conf` | vhost đề xuất → chép sang `/root/infra-qkenn/nginx/conf.d/qkenn.cloud.conf` |

## Bố cục trên VPS

```
/var/www/qkenn.cloud/
├── releases/
│   ├── initial/                                   placeholder cũ (bước chuyển đổi)
│   ├── 20260925T101500Z-<sha40>/                  mỗi lần build 1 thư mục
│   └── …                                          giữ 5 bản mới nhất (+ current, previous)
├── current  -> releases/<id>                      nginx root
├── previous -> releases/<id>                      bản ngay trước (nginx lấy /_astro/* cũ từ đây)
└── .deploy.lock                                   flock — không cho 2 deploy/rollback chạy cùng lúc
/var/log/qkenn-site-deploy.log                     log mọi lần deploy/rollback/từ chối
```

Tên release là `<thời điểm UTC>-<sha>` chứ không chỉ `<sha>`: CMS publish build lại **cùng commit**
nhưng nội dung khác. Deploy mà nội dung y hệt bản đang chạy → không tạo release mới (`RESULT=unchanged`).

## Cài đặt một lần trên VPS

Làm theo đúng thứ tự — site vẫn chạy bình thường trong suốt quá trình.

### 1. Cài script nhận

```bash
cd /home/projects/qkenn-site && git pull
bash deploy/test-receive.sh                    # phải: "86 passed, 0 failed" (thư mục tạm; máy không có zstd: 85)
install -o root -g root -m 0755 deploy/receive.sh /usr/local/bin/qkenn-site-receive
```

Vì sao là **bản sao** ở `/usr/local/bin` mà không trỏ forced command thẳng vào repo: `/home/projects`
thuộc user `qkenn`, user đó có thể đổi tên/thay thư mục repo → code chạy dưới quyền root. Bản sao
root sở hữu chỉ đổi khi admin chủ động `install` lại (xem [Cập nhật receive.sh](#cập-nhật-receivesh)).

### 2. Chuyển placeholder sang bố cục releases

Trước lần làm đầu tiên: nếu `/var/www/qkenn.cloud` đã có `current`, `previous`, `releases/` hay `.deploy.lock`
do chạy thử trước đó (vd test lỡ deploy vào thư mục thật) **và nginx chưa trỏ vào `current`** (chưa làm bước 3)
thì xoá chúng trước — nếu không, lệnh bên dưới thấy `current` đã có sẽ bỏ qua và giữ nguyên bản chạy thử:

```bash
cd /var/www/qkenn.cloud && ls -la              # lần đầu chỉ nên có index.html (placeholder)
grep -n 'root ' /root/infra-qkenn/nginx/conf.d/qkenn.cloud.conf   # còn "root /var/www/qkenn.cloud;" mới được xoá
rm -rf -- current previous releases .deploy.lock                  # CHỈ khi có rác chạy thử và chưa làm bước 3
```

Rồi (chạy lại nhiều lần cũng không sao — `current` đã là symlink thì bỏ qua):

```bash
cd /var/www/qkenn.cloud
[ -L current ] || { mkdir -p releases/initial && cp -a index.html releases/initial/ && ln -s releases/initial current; }
ls -la /var/www/qkenn.cloud                    # current -> releases/initial
```

(nginx cũ vẫn trỏ `/var/www/qkenn.cloud` nên site chưa đổi gì.)

### 3. Áp vhost nginx mới (qua infra-qkenn: backup + `nginx -t` + tự khôi phục nếu lỗi)

```bash
cd /root/infra-qkenn
git status --short                             # nên sạch — sync-nginx.sh chép MỌI *.conf của repo
cp /home/projects/qkenn-site/deploy/nginx-qkenn.cloud.conf nginx/conf.d/qkenn.cloud.conf
git diff nginx/conf.d/qkenn.cloud.conf         # xem lại
./scripts/sync-nginx.sh
git add nginx/conf.d/qkenn.cloud.conf
git commit -m "qkenn.cloud: root -> current (releases), cache /_astro, trang 404"
```

Kiểm tra (phải đi qua Cloudflare — curl 127.0.0.1 sẽ bị allowlist trả 403):

```bash
curl -sI https://qkenn.cloud/ | grep -iE '^(HTTP|cache-control)'   # 200 + Cache-Control: no-cache
```

vhost mới so với bản cũ:
- `root /var/www/qkenn.cloud/current`; TLS, `server_name` (có www), allowlist Cloudflare kế thừa **giữ nguyên**.
- `absolute_redirect off;` — `/gioi-thieu` → `301 Location: /gioi-thieu/` (tương đối, không bao giờ ra `http://` hay host origin).
- `try_files $uri $uri/ $uri.html =404;` + `error_page 404 /404.html;`
- `error_page 403 =404 /404.html;` — thư mục không có index.html (vd `/en/blog/category/`) trả trang 404 của site;
  client ngoài Cloudflare vẫn nhận 403 trần.
- `/_astro/*`: `Cache-Control: public, max-age=31536000, immutable`; không có ở bản hiện tại → lấy từ `previous`
  (trang HTML cũ đang mở đúng lúc deploy vẫn tải được CSS/JS).
- Mọi thứ khác (HTML, rss, sitemap, robots, favicon, cả 301/404): `Cache-Control: no-cache` (ETag → 304).
- gzip thêm CSS/JS/SVG/XML/JSON (nginx.conf chỉ bật cho text/html).
- **Không** bật `open_file_cache` cho vhost này (sẽ giữ đường dẫn bản cũ sau khi đổi symlink).

### 4. Dọn file cũ

```bash
rm /var/www/qkenn.cloud/index.html            # bản gốc đã nằm ở releases/initial, nginx không còn phục vụ file này
```

### 5. Cho khoá GitHub Actions vào — CHỈ chạy được qkenn-site-receive

Khoá `/root/.ssh/gha_site_deploy` (ed25519, comment `github-actions-site-deploy`) đã được tạo sẵn. Nếu chưa có:
`ssh-keygen -t ed25519 -N '' -C github-actions-site-deploy -f /root/.ssh/gha_site_deploy`

```bash
cp -a /root/.ssh/authorized_keys /root/.ssh/authorized_keys.bak-$(date +%Y%m%d%H%M%S)
grep -q 'github-actions-site-deploy' /root/.ssh/authorized_keys || \
  printf 'restrict,command="/usr/local/bin/qkenn-site-receive" %s\n' "$(cat /root/.ssh/gha_site_deploy.pub)" \
  >> /root/.ssh/authorized_keys
tail -1 /root/.ssh/authorized_keys
# restrict,command="/usr/local/bin/qkenn-site-receive" ssh-ed25519 AAAA… github-actions-site-deploy
```

`restrict` = tắt hết port/agent/X11 forwarding, PTY, `~/.ssh/rc` (và mọi tính năng OpenSSH thêm sau này).
Lệnh client gửi (`deploy <sha>`) chỉ là **tham số** đọc từ `SSH_ORIGINAL_COMMAND`, khớp chính xác, không bao giờ eval.

Thử ngay trên VPS:

```bash
K='-i /root/.ssh/gha_site_deploy -o IdentitiesOnly=yes'
ssh $K root@127.0.0.1 list                     # SITE_ROOT=/var/www/qkenn.cloud / initial  <- current
ssh $K root@127.0.0.1 id                       # ✗ LỖI: lệnh bị từ chối …
```

### 6. Secret / variable trên GitHub (repo qkenn04/qkenn-site)

Settings → Secrets and variables → Actions:

| Tên | Loại | Giá trị |
|---|---|---|
| `SSH_HOST` | secret | `213.199.51.252` (IP thật — không đi qua Cloudflare) |
| `SSH_USER` | secret | `root` |
| `SSH_KEY_B64` | secret | private key `gha_site_deploy` dạng base64 một dòng |
| `SSH_KNOWN_HOSTS` | secret (khuyến nghị) | host key VPS → Actions xác minh đúng máy; thiếu thì bỏ qua xác minh (như repo cms) |
| `DISCORD_WEBHOOK` | secret (tuỳ chọn) | có thể dùng chung webhook với repo cms |
| `CMS_URL` | **variable** (tuỳ chọn) | mặc định `https://cms.qkenn.cloud` |

Đặt secret từ máy có `gh` (khoá đi thẳng qua pipe, **không hiện ra màn hình, không dán vào chat**):

```bash
R=qkenn04/qkenn-site
ssh root@213.199.51.252 'base64 -w0 /root/.ssh/gha_site_deploy' | gh secret set SSH_KEY_B64 -R $R
gh secret set SSH_HOST -R $R --body 213.199.51.252
gh secret set SSH_USER -R $R --body root
ssh root@213.199.51.252 'cut -d" " -f1,2 /etc/ssh/ssh_host_ed25519_key.pub' \
  | sed 's/^/213.199.51.252 /' | gh secret set SSH_KNOWN_HOSTS -R $R
gh secret list -R $R
```

Không có `gh`: chạy `ssh root@213.199.51.252 'base64 -w0 /root/.ssh/gha_site_deploy'` rồi dán thẳng
vào ô secret trên giao diện GitHub (macOS: thêm `| pbcopy`).

Thiếu `SSH_KEY_B64`/`SSH_HOST` → job deploy chỉ cảnh báo `::warning::` và bỏ qua (bản build vẫn ở artifact `site`).

### 7. Chạy thử

```bash
gh workflow run deploy.yml -R qkenn04/qkenn-site --ref main
gh run watch -R qkenn04/qkenn-site
ssh root@213.199.51.252 /usr/local/bin/qkenn-site-receive list
curl -sI https://qkenn.cloud/gioi-thieu | grep -iE '^(HTTP|location)'   # 301, Location: /gioi-thieu/
```

## CMS kích hoạt build thế nào

Payload CMS (`/root/cms`, hook `src/hooks/triggerSiteRebuild.ts` trên collection **posts**, **pages** và global
**site-settings**) gọi `workflow_dispatch` của workflow này:

```
POST https://api.github.com/repos/qkenn04/qkenn-site/actions/workflows/deploy.yml/dispatches
{"ref":"main","inputs":{"reason":"publish|unpublish|delete|settings","slug":"<slug>"}}
```

- posts/pages: chỉ khi nội dung **public** đổi (publish, unpublish, xoá bài đang public); lưu nháp/autosave không
  kích hoạt. Chỉ document có `site = qkenn`.
- site-settings (menu, footer…): **mỗi lần lưu** đều build lại, `reason=settings`, `slug=site-settings`.
- Chỉ khi `NODE_ENV=production` (hoặc `SITE_REBUILD_ENABLED=true`).
- Chỉ gửi đúng 2 input `reason`, `slug` (khai trong `on.workflow_dispatch.inputs`); thêm key khác → GitHub trả **422**.
- Cần trong `/root/cms/.env`: `SITE_REPO=qkenn04/qkenn-site`, `SITE_WORKFLOW=deploy.yml` (mặc định) và
  `GITHUB_DISPATCH_TOKEN` = **fine-grained PAT**:
  - Repository access: **Only select repositories → `qkenn04/qkenn-site`**, không repo nào khác.
  - Repository permissions: **Actions: Read and write** — không gì khác (GitHub tự thêm Metadata: Read-only, bắt buộc).
    Không cấp Contents, Workflows, Secrets, Variables, Administration…
  - Vì sao: gọi `workflow_dispatch` chỉ cần Actions: write. Token lộ (vd từ container CMS) thì chỉ chạy/huỷ/chạy lại
    workflow hay xoá log/artifact được — **không push được code**, không sửa workflow, không đọc secret; chạy lại run
    cũ thì job deploy tự bỏ qua (xem [Rollback](#rollback)). `repository_dispatch` (cách cũ) buộc cấp
    **Contents: Read and write** = push thẳng lên main → code tuỳ ý chạy trên Actions cùng secret SSH deploy.
  - Chuyển từ PAT cũ: tạo PAT mới như trên → thay trong `.env` → khởi động lại CMS → **revoke PAT Contents: write cũ**.
- Không cần chạy tay sau khi publish hay sửa site-settings; chỉ chạy tay workflow (bước 7) khi dispatch **thất bại**
  (log CMS: `site rebuild dispatch thất bại … HTTP <mã>` hoặc `site rebuild dispatch lỗi mạng`).
- `repository_dispatch` `cms-publish` vẫn được nhận để tương thích ngược (chỉ chạy workflow trên nhánh mặc định main).

Giả lập CMS gọi:

```bash
gh workflow run deploy.yml -R qkenn04/qkenn-site --ref main -f reason=publish -f slug=thu-nghiem
# Kiểm tra đúng PAT của CMS (204 = OK; 403/404 = thiếu Actions: write hoặc sai repo):
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $GITHUB_DISPATCH_TOKEN" \
  -H 'Accept: application/vnd.github+json' \
  https://api.github.com/repos/qkenn04/qkenn-site/actions/workflows/deploy.yml/dispatches \
  -d '{"ref":"main","inputs":{"reason":"publish","slug":"thu-nghiem"}}'
```

Publish nhiều bài liên tiếp: build mới **huỷ** build cũ đang chạy (build nào cũng lấy main + nội dung CMS
mới nhất), chỉ bản mới nhất được deploy.

## Rollback

```bash
V=root@213.199.51.252; RX=/usr/local/bin/qkenn-site-receive
ssh $V $RX list                                # release mới nhất ở trên; đánh dấu current / previous
ssh $V $RX rollback previous                   # về bản ngay trước (chạy lần nữa = quay lại)
ssh $V $RX rollback 20260925T101500Z-<sha40>   # về đúng một release
ssh $V $RX rollback <sha40>                    # release mới nhất của commit đó
ssh $V $RX rollback initial                    # placeholder ban đầu
```

Tức thời, nguyên tử, không cần reload nginx. Chỉ quay về được release còn trong `releases/`
(5 bản mới nhất + current + previous).

**Rollback là tạm thời**: lần push/CMS publish sau sẽ deploy bản build mới từ main. Muốn giữ:
revert commit lỗi trên main, hoặc tạm tắt workflow `gh workflow disable deploy.yml -R qkenn04/qkenn-site`
(bật lại: `gh workflow enable …`).

**Đừng "Re-run" một run đã bị run mới hơn thay thế** — để quay về bản cũ hay để deploy lại: run đó mang commit cũ
(re-run riêng job deploy còn gửi lại đúng artifact cũ) và sẽ đè lên bản mới hơn. Job deploy tự chặn: từ lần chạy thứ 2
(`run_attempt > 1`), nếu đã có run **thành công** mới hơn của workflow trên main → `::warning::` và bỏ qua, không đụng VPS.
Deploy lại bản mới nhất: `gh workflow run deploy.yml -R qkenn04/qkenn-site --ref main`; về bản cũ: `rollback` như trên.

## Vì sao an toàn khi huỷ / đứt giữa chừng

- Chỉ một thao tác đụng bản đang phục vụ: `mv -T current.new current` (rename(2), nguyên tử).
  Trước đó mọi thứ nằm trong `releases/<id>.tmp`; khách luôn thấy bản cũ **đầy đủ** hoặc bản mới **đầy đủ**.
- Upload bị cắt (Actions huỷ, mạng rớt) → gzip báo thiếu → từ chối, site không đổi.
- Script bỏ qua HUP/PIPE: đã nhận đủ dữ liệu thì chạy nốt kể cả khi client đã đi.
- Bị `kill -9` giữa chừng → chỉ còn rác `*.tmp`/`.work.*`, lần chạy sau (đang giữ khoá) tự dọn.
- Xoá release cũ: đổi tên sang `*.del` rồi mới xoá → không bao giờ còn release "dở dang" để rollback nhầm.
- CI: nhóm concurrency `site-build-<ref>` huỷ build cũ (không đụng VPS); nhóm `site-deploy`
  **không** huỷ deploy đang chạy → deploy luôn theo thứ tự, bản chờ bị thay bằng bản mới hơn.
  Re-run một run cũ khi đã có run thành công mới hơn → job deploy bỏ qua (xem [Rollback](#rollback)).
- Archive bị kiểm tra trước khi giải nén: chỉ file/thư mục thường (từ chối symlink, hardlink, thiết bị,
  FIFO), không đường dẫn tuyệt đối, không `..`; tối đa 200 MB nén, 50 000 mục; phải có `index.html`.
- Tối đa 1 GB sau giải nén, chặn ở 3 chỗ: luồng tar sau gunzip (dừng ở 1 GB — gzip bomb), tổng kích thước các
  file khai trong archive trước khi giải nén (file sparse khai khống), và `du -sb` thư mục release sau giải nén.
  `tar` luôn đọc archive từ **stdin** nên không tự giải nén lớp trong: archive nén lồng (gzip bọc
  tar.xz/.bz2/.zst/.gz…) bị từ chối ("Archive is compressed") chứ không bung ra quá giới hạn.
- File release: root sở hữu, thư mục 755, file 644 — nginx (www-data) chỉ đọc được, không ghi được.

## Cập nhật receive.sh

Bản chạy thật **không tự cập nhật** theo repo (cố ý). Sau khi sửa và merge — **đọc kỹ thay đổi trong `deploy/`
trước**: cả `test-receive.sh` lẫn bản cài đều là code từ repo (thư mục của user `qkenn`) chạy dưới quyền **root**:

```bash
cd /home/projects/qkenn-site && git fetch
git status --short -- deploy/                  # phải trống: không có sửa đổi cục bộ chưa commit
git diff HEAD @{u} -- deploy/                  # XEM KỸ mọi thay đổi trước khi chạy gì dưới root
git pull --ff-only
diff -u /usr/local/bin/qkenn-site-receive deploy/receive.sh   # đúng phần sắp cài
bash deploy/test-receive.sh && install -o root -g root -m 0755 deploy/receive.sh /usr/local/bin/qkenn-site-receive
```

## Lỗi thường gặp

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| `current tồn tại nhưng không phải symlink` | Chưa làm bước 2 |
| `đang có deploy/rollback khác chạy` | Chờ; kiểm tra tiến trình treo: `fuser -v /var/www/qkenn.cloud/.deploy.lock` |
| `Permission denied (publickey)` | Sai dòng authorized_keys (bước 5) hoặc sai `SSH_KEY_B64` |
| `Host key verification failed` | VPS đổi host key → cập nhật `SSH_KNOWN_HOSTS` |
| Build fail `Thiếu dist/…` hoặc lỗi CMS | CMS không phản hồi / dữ liệu lỗi → không deploy, site giữ nguyên bản cũ |
| Deploy xong nhưng trang cũ | Có rule Cloudflare "Cache Everything" cho HTML? Bỏ rule hoặc purge cache |
| `Re-run của run #N nhưng run #M (mới hơn) đã thành công — BỎ QUA deploy` | Cố ý (xem Rollback). Deploy lại bằng `gh workflow run deploy.yml …` |
| Log CMS `site rebuild dispatch thất bại … HTTP 403/404/422` | 403/404: PAT thiếu Actions: write hoặc sai repo; 422: gửi input lạ / workflow trên main chưa khai inputs. Sửa xong chạy tay (bước 7) |

Log: `tail -50 /var/log/qkenn-site-deploy.log`
