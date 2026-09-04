# Auto SERP Research Collector

Tool Windows tự động thu thập dữ liệu nghiên cứu SERP của Google cho **một từ khóa mỗi lần chạy**.
Mỗi lần chạy tạo đúng **1 file Markdown + 2 file CSV** trong một thư mục kết quả.

- Nền tảng: Windows 10/11
- Cài đặt: **một dòng lệnh** — xem [Setup lần đầu](#1-setup-lần-đầu)
- Điểm chạy: `RUN.bat`
- Công nghệ: Node.js + Playwright (CDP) + Chrome for Testing với **profile riêng cho automation**
- Máy đích **không cần cài sẵn Node, Chrome hay extension nào** — tất cả đi kèm hoặc tự tải

---

## Mục lục

1. [Setup lần đầu](#1-setup-lần-đầu)
2. [Cách chạy](#2-cách-chạy)
3. [Cấu trúc output](#3-cấu-trúc-output)
4. [Xử lý login và CAPTCHA](#4-xử-lý-login-và-captcha)
5. [Troubleshooting](#5-troubleshooting)
6. [Cấu hình](#6-cấu-hình)
7. [Kiến trúc và cách hoạt động](#7-kiến-trúc-và-cách-hoạt-động)
8. [Test](#8-test)
9. [Giới hạn đã biết](#9-giới-hạn-đã-biết)

---

## 1. Setup lần đầu

### Cài trên máy mới bằng một dòng lệnh

Máy trắng — **chưa cài Git, chưa cài Node, chưa cài Chrome** — mở PowerShell rồi dán **một dòng**:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/mktphuchung-wq/SERP-Extractor/main/install.ps1 | iex
```

Không phải cài trước bất cứ thứ gì. Installer chỉ dùng PowerShell và `tar` — cả hai có sẵn trong
Windows 10/11.

Nếu repo chuyển sang private thì thêm token:

```powershell
$env:SERP_TOKEN='<github token>'; Set-ExecutionPolicy Bypass -Scope Process -Force; irm -Headers @{Authorization="Bearer $env:SERP_TOKEN"} https://raw.githubusercontent.com/mktphuchung-wq/SERP-Extractor/main/install.ps1 | iex
```

Đã có sẵn thư mục tool (copy qua USB, ổ mạng) thì double-click **`INSTALL.bat`**.

Installer tự làm hết, không hỏi gì:

| Bước | Việc | Cần cài trước gì không |
| --- | --- | --- |
| 1 | Tải mã nguồn về `%USERPROFILE%\SERP-Extractor` (đổi bằng `$env:SERP_DIR`) | Không — tải ZIP bằng PowerShell |
| 2 | Tải **Node.js portable** vào `runtime\node\` — đối chiếu SHA256 với `SHASUMS256.txt` của nodejs.org | Không |
| 3 | `npm install` bằng npm đi kèm bản Node vừa tải | Không |
| 4 | Tải **Chrome for Testing** vào `runtime\chrome\` (~200 MB) | Không |
| 5 | Kiểm tra mã nguồn đủ file + 3 extension sinh đúng extension ID | Không |
| 6 | Tạo lối tắt trên Desktop | Không |

Tổng tải về ~230 MB, chiếm ~560 MB trên đĩa. Chỉ tải một lần.

**Về Git:** không bắt buộc. Máy nào *có sẵn* Git thì installer dùng `git clone` — cập nhật sau này
chỉ tốn vài KB qua `git pull`. Máy không có Git thì tải ZIP (~1,5 MB) và cập nhật cũng bằng ZIP.
Cả hai đường đều cho ra kết quả giống hệt nhau.

### Việc duy nhất phải làm bằng tay (một lần trên mỗi máy)

Chạy **`OPEN_CHROME.bat`**, rồi trong cửa sổ Chrome vừa mở:

| # | Việc cần làm | Vì sao không tự động được |
| --- | --- | --- |
| 1 | Đăng nhập tài khoản Google | Credential — tool không nhập hộ |
| 2 | Xử lý màn hình consent/CAPTCHA nếu Google hỏi | Profile mới tinh chưa có cookie nên Google hay chặn lần đầu |
| 3 | Đăng nhập Ahrefs | Extension Ahrefs không có tài khoản thì không trả về Keywords Ideas |
| 4 | Trong Ahrefs SEO Toolbar chọn country = **United States** | Thiết lập của extension, lưu trong profile |

Xong bước này thì phiên đăng nhập nằm trong profile automation và **được giữ qua mọi lần chạy sau**.

Từ đó về sau: double-click **`RUN.bat`** (hoặc lối tắt *SERP Extractor* trên Desktop) và nhập từ khóa.

### Yêu cầu

| Thành phần | Ghi chú |
| --- | --- |
| Windows 10/11 | |
| Kết nối Internet | Lúc cài (~230 MB) và lúc chạy |
| Node.js | **Không cần cài** — installer tải bản portable vào `runtime\node\` |
| Google Chrome | **Không cần cài** — installer tải Chrome for Testing vào `runtime\chrome\` |
| Tài khoản Ahrefs | Chỉ cần nếu muốn có Keywords Ideas |

### Extension và nguồn dữ liệu

Bundle cũ vẫn nằm trong `vendor/extensions/` để tương thích với máy đã cài, nhưng workflow production chỉ phụ thuộc **Ahrefs SEO Toolbar** khi cần Keywords Ideas.

| Thành phần | Vai trò trong workflow hiện tại |
| --- | --- |
| Ahrefs SEO Toolbar | Keywords Ideas, People Also Asked và thị trường US |
| Native Google DOM extractor | Organic SERP Page 1 và Page 2, schema CSV canonical |
| Google Suggestions DOM + endpoint | Search Suggestions, không mở popup extension |
| SERP Extractor Bridge | Kết nối tool với Chrome đang mở khi dùng engine `bridge` |

`SEO SERP Extraction Tool` và `Google Search Suggestion Extractor` không còn được gọi trong workflow tự động; thiếu hai extension này không ảnh hưởng SERP CSV hoặc Suggestions.

Hai chi tiết kỹ thuật quan trọng đằng sau:

1. **Extension ID phải giữ nguyên.** Các adapter mở thẳng `chrome-extension://<id>/popup.html`. Bản tải
   từ Web Store đã có sẵn trường `key` trong `manifest.json`, nên khi nạp dạng unpacked Chrome vẫn sinh
   ra đúng ID cũ. `tools/pack-extensions.mjs` và `verifyBundle()` đều kiểm tra lại điều này — nếu `key`
   sinh ra ID khác ID trong config thì báo lỗi thay vì để adapter trỏ nhầm chỗ.
2. **Chỉ Chrome for Testing nạp được.** Google Chrome bản chính thức từ 137 trở đi **bỏ qua**
   `--load-extension` (in cảnh báo `--load-extension is not allowed in Google Chrome, ignoring`), kể cả
   khi tắt feature flag. Vì vậy tool dùng Chrome for Testing — bản build chính chủ của Google, không bị
   chặn cờ này, không tự động cập nhật (phiên bản ghim trong `config/runtime.json`), và không đụng gì tới
   Chrome cá nhân của bạn.

> **Lưu ý khi nâng cấp một máy đang chạy bản cũ:** Chrome for Testing **gỡ các extension đã cài từ Web
> Store** ra khỏi profile automation ngay lần khởi động đầu tiên (nó không có kênh xác minh Web Store).
> Điều này vô hại vì bản đóng gói thay thế hoàn toàn, và **cookie/phiên đăng nhập Google + Ahrefs vẫn còn
> nguyên**. Lần đầu mở profile cũ bằng Chrome for Testing cũng mất thêm ít giây để nâng cấp profile —
> đó là lý do `connectCdp()` thử lại hai lần.

### Cập nhật lên máy đã cài

Chạy lại `INSTALL.bat` (hoặc dán lại dòng lệnh cài đặt). Nó tự chọn đường phù hợp:

| Máy cài bằng | Cách cập nhật | Tải về |
| --- | --- | --- |
| `git clone` (máy có Git) | `git pull --ff-only` | vài KB |
| ZIP (máy không có Git) | Tải lại ZIP, thay `src/ scripts/ tools/ config/ vendor/ tests/` | ~1,5 MB |

Cả hai đường đều **không đụng** tới `runtime/`, `node_modules/`, `output/`, `logs/` và
`config/local.yaml` — cấu hình riêng và dữ liệu của bạn được giữ nguyên. Đường ZIP xóa rồi chép lại
các thư mục mã nguồn nên file đã bị gỡ trên repo không còn sót lại.

> **Về quyền riêng tư:** tool dùng một profile Chrome **riêng**, không đọc, không sao chép cookie
> hay lịch sử từ profile Chrome cá nhân của bạn. Cổng debug chỉ mở trên `127.0.0.1`.

### Tại sao không dùng thẳng cửa sổ Chrome đang mở của tôi?

Câu hỏi rất hợp lý — Chrome cá nhân đã có sẵn tài khoản và extension. Nhưng **không làm được**, vì hai lý do:

1. **Chrome chặn ở tầng trình duyệt.** Từ Chrome 136, cờ `--remote-debugging-port` **không còn được chấp
   nhận** khi trỏ vào thư mục dữ liệu mặc định — Google đổi vì cổng debug bị lợi dụng để trộm cookie.
   Tài liệu chính thức ghi rõ cờ này *"phải đi kèm `--user-data-dir` trỏ tới một thư mục không mặc định"*
   ([nguồn](https://developer.chrome.com/blog/remote-debugging-port)). Máy bạn đang chạy Chrome 151.
2. **Cửa sổ Chrome đang mở không có cổng debug.** Chrome phải được khởi động *ngay từ đầu* với cờ đó;
   không bật thêm được cho một cửa sổ đã chạy. Muốn có, phải tắt toàn bộ Chrome và mở lại — mà mở lại
   với profile mặc định thì lại rơi vào lý do 1.

Ngoài ra đặc tả của chính dự án này (mục 4.2, 18, 19.1) cấm dùng profile cá nhân và cấm copy cookie từ đó.

**Cách đạt được điều bạn muốn** — có sẵn tài khoản + extension mà không phải làm lại mỗi lần:

| Cách | Làm gì |
| --- | --- |
| **Extension: không phải làm gì** | Ba extension đi kèm trong `vendor/extensions/` và được nạp tự động mỗi lần khởi động. Không cần Sync, không cần Web Store. |
| **Tài khoản: đăng nhập một lần** | Chạy `OPEN_CHROME.bat`, đăng nhập Google + Ahrefs. Phiên nằm trong profile automation và được giữ mãi. |
| **Giữ cửa sổ mở** | Chạy `OPEN_CHROME.bat` một lần vào đầu buổi làm việc. Cửa sổ đó ở lại; mọi lần `RUN.bat` sau đều **bám vào cửa sổ đang mở** thay vì bật Chrome mới — nhanh hơn và giữ nguyên phiên đăng nhập. |

Phiên đăng nhập của profile automation **được giữ qua các lần chạy**, nên bạn chỉ đăng nhập một lần.

> **An toàn:** trước mỗi lần chạy, tool đọc `chrome://version` để xác minh đang làm việc đúng profile
> automation. Nếu cổng debug lại thuộc về một Chrome khác (ví dụ profile cá nhân), tool **dừng lại** với
> mã `PROFILE_MISMATCH` thay vì âm thầm dùng nhầm profile của bạn.

---

## 2. Cách chạy

### Chế độ hỏi đáp (dễ nhất)

Double-click **`RUN.bat`**, rồi nhập:

```text
AUTO SERP RESEARCH COLLECTOR

Keyword: Filipino vs Samoan
AI prompt: What are the main similarities and differences between Filipino and Samoan people?
```

Nếu để trống AI prompt, tool dùng template trong `config/default.yaml`:

```text
Analyze the search topic "{{keyword}}" and explain the main intent, key subtopics, and important distinctions.
```

### Chế độ dòng lệnh

```bat
RUN.bat "Filipino vs Samoan" "What are the main similarities and differences?"
```

```bat
RUN.bat "Filipino vs Samoan"
```

### Nhiều từ khóa trong một lần chạy

Ngăn cách các từ khóa bằng dấu `;`. Mỗi từ khóa tạo **một thư mục kết quả riêng**:

```bat
RUN.bat "Filipino vs Samoan; Father's Day Outfit Ideas; best running shoes"
```

Ghép prompt riêng cho từng từ khóa (cũng ngăn cách bằng `;`, khớp theo thứ tự):

```bat
RUN.bat "kw mot; kw hai" "prompt cho kw mot; prompt cho kw hai"
```

Quy tắc ghép prompt:

| Số prompt nhập vào | Kết quả |
| --- | --- |
| Không nhập | Mỗi từ khóa dùng prompt template trong config |
| 1 prompt | Dùng chung cho tất cả từ khóa |
| Nhiều prompt | Khớp theo thứ tự; từ khóa thừa dùng template |

Các từ khóa **chạy lần lượt**, không chạy song song với nhau — Google và extension phụ thuộc trạng thái
tab/profile, chạy song song nhiều từ khóa dễ lấy nhầm dữ liệu (đặc tả mục 17). Từ khóa trùng nhau
(không phân biệt hoa/thường) được tự động loại bớt.

Một từ khóa lỗi **không** làm dừng hàng đợi. Cuối lần chạy có bảng tổng kết và một file tổng kết lưu ở
`logs\batch-<timestamp>\`:

```text
============================================================
  TONG KET
============================================================
[  OK] Filipino vs Samoan
       D:\...\output\Filipino vs Samoan
       AI 3414 ky tu | Ideas 8 | PAA 4 | Suggestions 6 | P1 20 | P2 10
[CANH] Father's Day Outfit Ideas
       ...
Thanh cong 2/3. Tong ket: D:\...\logs\batch-20260821-143000\batch-summary-tong-ket.txt
```

### Mở kết quả bằng Notepad

Chạy xong, tool tự mở file `.md` bằng Notepad để bạn đọc ngay (chạy nhiều từ khóa thì mở file tổng kết).
Tắt bằng `--no-open`, hoặc đặt `notifications.open_result: false` trong config. Đổi trình soạn thảo
bằng `notifications.open_result_with`.

### Sửa selector khi Google/Ahrefs đổi giao diện

Đây là việc phải làm định kỳ, vì Google đổi DOM liên tục. **Không đoán selector** — lấy DOM thật ra rồi soạn:

```bash
RUN.bat "seo keyword" --capture-dom
```

Chỉ chụp một vài block:

```bash
RUN.bat "seo keyword" --capture-dom=ahrefs_widget,google_suggestions
```

Kết quả nằm ở `logs\<run_id>\dom-snapshots\`:

| File | Nội dung |
| --- | --- |
| `<block>.html` | DOM thật của block, **đã serialize cả shadow root** (đánh dấu bằng `<!--shadow-root open-->`) |
| `<block>.meta.json` | Block nằm ở đâu: main document / shadow root / iframe, selector nào đã trúng |
| `selector-candidates.md` | Bảng đề xuất selector, xếp theo độ ổn định |

Quy trình sửa:

1. Mở `selector-candidates.md`.
2. Với mỗi block, lấy selector ở dòng đầu bảng — chỉ nhận dòng có **`Duy nhất = co`**.
3. Chép vào **đầu** danh sách tương ứng trong `config/selectors.yaml`, tăng `selector_version`.
4. Copy file `.html` vào `tests/fixtures/` và thêm test.
5. Chạy lại — không còn `SELECTOR_DRIFT` cho block đó.

Báo cáo xếp hạng đề xuất theo thứ tự ổn định giảm dần: `data-*` có ngữ nghĩa → `role`+`aria-label`
→ `id` không ngẫu nhiên → tên custom element → class không phải hash → đường CSS ngắn nhất.
Mỗi đề xuất kèm số node khớp (phải bằng 1) và có nằm trong shadow root không.

Nếu báo cáo ghi **"Không tìm thấy block này"**: hoặc block không xuất hiện trên trang (extension chưa
bật / chưa đăng nhập), hoặc nó nằm trong **closed shadow root** — trường hợp này không đọc được bằng
bất kỳ cách nào, phải dùng nguồn khác.

### Mức độ cảnh báo

Không phải cảnh báo nào cũng đáng lo. Tool phân ba mức:

| Mức | Nghĩa | Ảnh hưởng trạng thái |
| --- | --- | --- |
| `INFO` | Phải dùng fallback nhưng dữ liệu vẫn đủ | Không — vẫn `SUCCESS` |
| `WARN` | Dữ liệu thiếu hoặc đáng nghi | `COMPLETED_WITH_WARNINGS` |
| `ERROR` | Một section bắt buộc bị rỗng | `COMPLETED_WITH_WARNINGS`, nêu rõ ở dòng tổng kết |

Dòng tổng kết cuối run:

```text
Canh bao: 1 ERROR | 0 WARN | 2 INFO (fallback)
  [ERROR] SUGGESTIONS_NOT_FOUND
  [INFO ] SELECTOR_DRIFT, SERP_MORE_RESULTS_THAN_EXPECTED
```

`SELECTOR_DRIFT` là `INFO` vì fallback vẫn cho dữ liệu đúng. Muốn siết lại (ví dụ chạy trong CI),
đặt `logging.strict_selectors: true` để nâng nó thành `WARN`.

### Thứ tự thu thập cố định

Mỗi từ khóa chạy trên một tab theo đúng thứ tự phụ thuộc của giao diện thật:

1. Google Search Suggestions.
2. Ahrefs Keywords Ideas.
3. Ahrefs People Also Asked.
4. Xuất đủ hai CSV Page 1 và Page 2.
5. Nạp lại Page 1, mở AI Overview rồi chạy `Show more → Prompt → Load → Copy answer`.
6. Ghi ba file đầu ra và chạy quality gate.

Thứ tự này tránh tranh chấp tab active/clipboard giữa Ahrefs và AI, đồng thời bảo đảm CSV được lấy xong
trước khi AI Overview thay đổi giao diện. `--parallel` và `--sequential` chỉ còn được nhận để tương thích
với lệnh cũ; workflow luôn dùng thứ tự cố định trên.

### Tiến trình hiển thị

```text
[1/8] Khoi dong Chrome profile rieng...
[2/8] Mo Google SERP (US/English, pws=0)...
[3/8] Thu thap Google Search Suggestions truoc tien...
[4/8] Thu thap Keywords Ideas tu Ahrefs...
[5/8] Thu thap People Also Asked...
[6/8] Xuat du 2 CSV Page 1 va Page 2...
[7/8] AI Overview Page 1: Show more -> Prompt -> Copy answer...
[8/8] Ghi file va kiem tra chat luong...

SUCCESS
Keyword: Filipino vs Samoan
Folder:  D:\WORK\Projects\SERP Extractor\output\Filipino vs Samoan
```

### Tham số dòng lệnh

| Tham số | Ý nghĩa |
| --- | --- |
| `--config <file>` | Dùng file cấu hình khác |
| `--overwrite` | Cho phép ghi đè thư mục kết quả (luôn backup vào `logs\` trước) |
| `--require-extensions` | Dừng ngay nếu thiếu extension |
| `--keep-staging` | Giữ thư mục staging sau khi chạy (để debug) |
| `--verbose` | Log chi tiết |
| `--sequential` / `--parallel` | Cờ tương thích lệnh cũ; workflow hiện luôn chạy theo thứ tự cố định |
| `--no-open` | Không tự mở file kết quả bằng Notepad |
| `--capture-dom[=a,b]` | Chụp DOM thật của từng block kèm báo cáo đề xuất selector |
| `--setup` | Chạy riêng phần cài đặt lần đầu rồi thoát |
| `--skip-setup` | Bỏ qua bước kiểm tra cài đặt |
| `--no-interactive` | Không hỏi đáp, không pause chờ login/CAPTCHA (dùng khi chạy tự động) |
| `--diagnose` | Kiểm tra môi trường rồi thoát |
| `--check-setup` | Kiểm tra 3 extension rồi thoát |

### Các file `.bat` khác

| File | Dùng khi nào |
| --- | --- |
| **`INSTALL.bat`** | **Cài đặt / cập nhật.** Tải Node portable + Chrome for Testing + package |
| **`RUN.bat`** | **Launcher chính.** Thiếu runtime thì tự gọi installer rồi chạy tiếp |
| `OPEN_CHROME.bat` | Mở cửa sổ Chrome automation (để đăng nhập lần đầu, hoặc để các lần chạy sau bám vào) |
| `SETUP.bat` | Tên cũ, nay chỉ chuyển tiếp sang `INSTALL.bat` |
| `DIAGNOSE.bat` | Khi có lỗi — kiểm tra runtime, Chrome, profile, bundle extension, cổng CDP, quyền ghi |
| `SMOKE_TEST.bat` | Kiểm tra định kỳ xem selector còn chạy không (ghi ra thư mục tạm, không đụng `output\`) |
| `TEST.bat` | Chạy unit test + integration test |
| `_env.bat` | Không chạy trực tiếp — các file trên `call` nó để tìm Node portable |

Script Node dùng cho việc bảo trì:

| Lệnh | Dùng khi nào |
| --- | --- |
| `node scripts\bootstrap.mjs` | Chạy lại phần cài đặt (không đụng tới mã nguồn) |
| `node scripts\bootstrap.mjs --update-runtime` | Ghim phiên bản Chrome for Testing mới nhất vào `config\runtime.json` |
| `node tools\pack-extensions.mjs` | **Chỉ trên máy dev.** Đóng gói lại 3 extension từ một profile Chrome đã cài chúng vào `vendor\extensions\` |

### Exit code

| Code | Ý nghĩa |
| --- | --- |
| `0` | Thành công, đủ ba file (kể cả `COMPLETED_WITH_WARNINGS`) |
| `1` | Input hoặc config không hợp lệ |
| `2` | Lỗi Chrome / profile / extension |
| `3` | Google yêu cầu consent hoặc đăng nhập |
| `4` | CAPTCHA chưa được xử lý |
| `5` | Lỗi thu thập AI Mode |
| `6` | Lỗi trích xuất SERP hoặc tải CSV |
| `7` | Kết quả không qua được quality gate |
| `8` | Lỗi không xác định |

---

## 3. Cấu trúc output

Thư mục kết quả **chỉ chứa đúng 3 file**. Log, screenshot, trace, manifest đều nằm **ngoài**.

```text
output\
└── Filipino vs Samoan\
    ├── Filipino vs Samoan.md
    ├── Filipino vs Samoan page 1.csv
    └── Filipino vs Samoan page 2.csv

logs\
└── 20260821-111530-filipino-vs-samoan\
    ├── run.log                 (log đọc được bằng mắt)
    ├── run.jsonl               (log dạng JSON để phân tích)
    ├── run-manifest.json       (nguồn dữ liệu, số lượng, warning, phiên bản selector)
    └── screenshots\            (ảnh chụp khi lỗi)
```

### Nội dung file Markdown

Luôn có **đúng 4 heading, đúng thứ tự**:

```markdown
## AI Mode

[Câu trả lời đầu tiên của AI Mode]

## Keywords Ideas

- keyword idea 1
- keyword idea 2

## People Also Asked

- question 1
- question 2

## Search Suggestion

- suggestion 1
- suggestion 2
```

Quy tắc:

- File luôn là UTF-8.
- Không bao giờ ghi `N/A`. Nếu một block không có dữ liệu, tool ghi cảnh báo rõ ràng, ví dụ:
  `> Khong tim thay AI Overview/AI Mode cho truy van nay.`
- Danh sách đã trim, bỏ dòng rỗng, deduplicate không phân biệt hoa/thường.
- Link nguồn trong câu trả lời AI được chuyển thành Markdown link.
- Tool không tự dịch nội dung.

### Về section `## Search Suggestion`

Đây là phần dễ ra dữ liệu sai nhất, nên tool làm đúng theo thao tác tay:

1. Đưa con trỏ vào ô tìm kiếm để dropdown gợi ý hiện ra.
2. Đọc trực tiếp dropdown bằng DOM.
3. Dùng endpoint autocomplete của Google để bổ sung và đối chiếu các dòng có thể bị nhận nhầm là lịch sử cá nhân.

Workflow không mở popup extension Suggestions vì popup dạng tab không xác định đáng tin cậy tab Google đang active.

**Lọc gợi ý cá nhân.** Khi bạn đã đăng nhập Google, dropdown trộn lẫn hai loại:

| Loại | Dấu hiệu | Tool xử lý |
| --- | --- | --- |
| Gợi ý thật của Google | Không có nút xóa | Giữ |
| Lịch sử tìm kiếm của tài khoản bạn | Có nút **Delete** ở cuối dòng | **Loại bỏ** |

Lịch sử tìm kiếm của chính bạn không phải Google Search Suggestion, và trái với mục tiêu `pws=0`
(tắt cá nhân hóa). Tool loại chúng và ghi cảnh báo `SUGGESTIONS_PERSONALIZED` kèm danh sách đã bỏ.
Nếu **toàn bộ** dropdown chỉ có lịch sử cá nhân, tool ghi `SUGGESTIONS_PERSONALIZED_ONLY` và để
cảnh báo trong file thay vì ghi dữ liệu sai.

Muốn giữ cả lịch sử cá nhân: đặt `extractors.exclude_personalized_suggestions: false`.

### Nội dung file CSV

Tool luôn dùng native Google DOM extractor và schema CSV canonical:

  ```csv
  position,title,url,displayed_url,description,result_type,source_page,captured_at
  ```

- Page 1 vị trí 1–10, Page 2 vị trí 11–20.
- Đã loại: quảng cáo/Sponsored, AI Overview, People also ask, carousel Videos/Images/Shopping/Forums,
  hàng của Ahrefs toolbar và mọi node `chrome-extension://`.
- Featured snippet được giữ lại nếu nó cũng là một kết quả organic hợp lệ (`result_type=featured_snippet`).

### Khi thư mục đã tồn tại

Mặc định **không ghi đè**. Tool tạo **thư mục** mới có hậu tố thời gian, nhưng **tên file giữ nguyên**:

```text
output\
├── Filipino vs Samoan\                      ← lần chạy đầu
│   ├── Filipino vs Samoan.md
│   ├── Filipino vs Samoan page 1.csv
│   └── Filipino vs Samoan page 2.csv
└── Filipino vs Samoan__20260821-111530\     ← lần chạy sau, thư mục có hậu tố
    ├── Filipino vs Samoan.md                 ← file vẫn tên sạch
    ├── Filipino vs Samoan page 1.csv
    └── Filipino vs Samoan page 2.csv
```

Nhờ vậy tên file luôn đoán được từ từ khóa, không phải đọc tên thư mục mới biết.

Đổi hành vi bằng `output.on_conflict` trong config: `timestamp` (mặc định) | `fail` | `overwrite`
(`overwrite` chỉ chạy khi có thêm cờ `--overwrite`, và luôn backup bản cũ vào `logs\<run_id>\output-backup\`).

---

## 4. Xử lý login và CAPTCHA

Tool **không bao giờ tự vượt CAPTCHA** và không dùng stealth plugin hay proxy để né giới hạn.

### Khi Google yêu cầu đăng nhập

Console hiện:

```text
============================================================
  CAN THAO TAC TAY: MANUAL_LOGIN_REQUIRED
  Google yeu cau dang nhap. Hay dang nhap trong cua so Chrome dang mo roi tiep tuc.
  Hay xu ly trong cua so Chrome dang mo, sau do nhan Enter.
============================================================
Nhan Enter de tiep tuc...
```

Việc cần làm:

1. Chuyển sang cửa sổ Chrome mà tool đang điều khiển (tiêu đề *Auto SERP Chrome*).
2. Đăng nhập tài khoản Google.
3. Quay lại cửa sổ console, **nhấn Enter**.

Tool kiểm tra lại trạng thái trang rồi **chạy tiếp từ bước đang dừng**, không chạy lại từ đầu.

### Khi Google yêu cầu xác minh (CAPTCHA)

Giống hệt như trên, mã lỗi là `MANUAL_CAPTCHA_REQUIRED`. Hãy tự giải CAPTCHA trong cửa sổ Chrome rồi nhấn Enter.
Tool đã chụp screenshot vào `logs\<run_id>\screenshots\` để bạn biết nó dừng ở đâu.

Thời gian chờ mặc định là 10 phút (`recovery.manual_pause_timeout_ms`). Hết giờ thì run kết thúc với exit code `3` hoặc `4`.

### Giảm khả năng bị chặn

- Chạy tuần tự từng từ khóa, không chạy song song nhiều run trên cùng profile.
- Giữ `search.min_delay_ms` / `max_delay_ms` ở mức mặc định hoặc cao hơn.
- Không tăng `search.pages` lên quá nhiều.
- Người vận hành chịu trách nhiệm dùng tool phù hợp với điều khoản của Google và của nhà cung cấp extension.

---

## 5. Troubleshooting

Bước đầu tiên luôn là chạy **`DIAGNOSE.bat`**.

| Triệu chứng / mã lỗi | Nguyên nhân thường gặp | Cách xử lý |
| --- | --- | --- |
| `CHROME_NOT_FOUND` | Chưa tải Chrome for Testing và máy cũng không có Chrome | Chạy `INSTALL.bat`. Muốn dùng một Chrome cụ thể thì đặt `browser.chrome_path` trong `config/local.yaml` — nhưng bản chính thức sẽ không nạp được extension |
| `CDP_CONNECT_FAILED` | Cổng 9222 bị chiếm, hoặc policy chặn remote debugging | Đổi `browser.remote_debugging_port` sang cổng khác (ví dụ 9333), đóng hết cửa sổ Chrome của profile automation rồi chạy lại |
| `PROFILE_LOCKED` | Đang có Chrome khác mở cùng profile nhưng không bật cổng debug | Đóng cửa sổ *Auto SERP Chrome* rồi chạy lại |
| `PROFILE_MISMATCH` | Cổng debug đang thuộc về một Chrome **khác** với profile automation | Tool cố ý dừng để không dùng nhầm profile cá nhân của bạn. Đóng cửa sổ Chrome đang giữ cổng đó, hoặc đổi `browser.remote_debugging_port` sang cổng khác |
| Cảnh báo `EXTENSION_MISSING` | Thiếu hoặc hỏng `vendor/extensions/`, hoặc đang chạy Google Chrome bản chính thức (bản này bỏ qua `--load-extension`) | Chạy `INSTALL.bat`. `DIAGNOSE.bat` cho biết đang dùng Chrome nào và bundle có đủ không |
| "Mở Chrome lên không thấy extension nào" | Đang chạy Google Chrome bản chính thức thay vì Chrome for Testing | Bản chính thức in `--load-extension is not allowed in Google Chrome, ignoring` rồi chạy tiếp không có extension. Chạy `INSTALL.bat`, hoặc đặt `browser.chrome_path: bundled` để tool báo lỗi thay vì chạy âm thầm thiếu extension |
| `AHREFS_WIDGET_NOT_FOUND` / `AHREFS_KEYWORD_IDEAS_UNAVAILABLE` | Extension Ahrefs chưa đăng nhập, chưa bật trên SERP, hoặc đổi giao diện | Mở Chrome automation, search thử, đăng nhập Ahrefs, bật toolbar. Tool **không** thay Keywords Ideas bằng nguồn khác, sẽ ghi cảnh báo trong file `.md` |
| `AHREFS_REGION_NOT_VERIFIED` | Không đọc/đổi được country trong toolbar | Chọn tay United States trong toolbar. URL vẫn luôn dùng `gl=us&hl=en&pws=0` |
| `AI_OVERVIEW_NOT_FOUND` / `AI_MODE_UNAVAILABLE` | Truy vấn không có AI Overview, hoặc Google chưa cấp AI Mode cho tài khoản/khu vực | Không phải lỗi. Section `## AI Mode` sẽ chứa cảnh báo, run vẫn `COMPLETED_WITH_WARNINGS` và vẫn đủ 3 file |
| `AI_RESPONSE_TIMEOUT` | Câu trả lời AI sinh quá chậm | Tăng `ai.response_timeout_ms` |
| `SUGGESTIONS_PERSONALIZED` (warning) | Dropdown có gợi ý lấy từ lịch sử tìm kiếm của tài khoản | Không phải lỗi — tool đã loại chúng ra. Muốn dữ liệu sạch hơn: dùng tài khoản khác hoặc xóa lịch sử tìm kiếm của profile automation |
| `SUGGESTIONS_PERSONALIZED_ONLY` (warning) | Dropdown **chỉ có** lịch sử cá nhân, không có gợi ý thật | Section `## Search Suggestion` sẽ ghi cảnh báo thay vì dữ liệu sai. Thường xảy ra khi từ khóa đã được tìm nhiều lần trên chính profile này |
| `SERP_PAGE_DUPLICATE` | Điều hướng `start=10` không có tác dụng | Tool tự thử lại một lần rồi dừng an toàn, không ghi dữ liệu sai. Thường do Google trả cùng một trang khi bị giới hạn |
| `SERP_MORE_RESULTS_THAN_EXPECTED` (warning) | Google bỏ qua `num=10` và trả về nhiều hơn 10 kết quả ở Page 1 (rất hay gặp) | Không phải lỗi. Tool giữ nguyên toàn bộ kết quả Google thực sự hiển thị và đánh số Page 2 tiếp sau Page 1 để hai file không chồng lấn vị trí |
| `OUTPUT_VALIDATION_FAILED` | Kết quả không qua quality gate | Xem `logs\<run_id>\run.log` để biết gate nào fail. Staging được giữ lại để debug |
| `SELECTOR_DRIFT` (warning) | Selector chính hỏng nhưng fallback vẫn chạy | Không chặn run. Đây là tín hiệu cần cập nhật `config/selectors.yaml` |
| Không có gì xảy ra khi double-click `.bat` | Node.js chưa cài hoặc chưa có trong PATH | Cài Node.js rồi mở lại cửa sổ |

Nếu vẫn không rõ nguyên nhân, gửi kèm:

- `logs\<run_id>\run.log`
- `logs\<run_id>\run-manifest.json`
- ảnh trong `logs\<run_id>\screenshots\`

Log đã được redact cookie/authorization và **prompt được lưu dưới dạng SHA-256**, không lưu nguyên văn.

---

## 6. Cấu hình

File `config/default.yaml`. Muốn giữ cấu hình riêng mà không sửa file gốc, tạo `config/local.yaml`
với chỉ những khóa cần đổi — tool sẽ merge đè lên default.

Các khóa hay dùng:

```yaml
browser:
  # auto    : ưu tiên Chrome for Testing trong runtime\chrome, thiếu thì dùng Chrome hệ thống
  # bundled : bắt buộc Chrome for Testing (báo lỗi nếu chưa tải)
  # system  : bắt buộc Chrome hệ thống — LƯU Ý bản chính thức bỏ qua --load-extension
  #           nên phải tự cài 3 extension vào profile automation
  chrome_path: auto
  user_data_dir: '%LOCALAPPDATA%\AutoSerpTool\chrome-profile'
  remote_debugging_port: 9222
  headless: false                   # AI Mode và extension cần UI thật

search:
  country: 'us'
  language: 'en'
  personalization: false            # -> pws=0
  pages: 2

ai:
  overview_timeout_ms: 15000
  response_timeout_ms: 120000
  stable_ms: 2500                   # nội dung không đổi bao lâu thì coi là xong

extractors:
  allow_keyword_ideas_fallback: false   # KHÔNG thay Keywords Ideas bằng nguồn khác
  paa_capture_mode: 'questions_only'    # hoặc 'questions_and_answers'
  suggestion_source: 'dom_then_endpoint'
  exclude_personalized_suggestions: true   # bỏ gợi ý lấy từ lịch sử tìm kiếm cá nhân
  serp_source: 'dom_only'               # native DOM, schema canonical ổn định

output:
  on_conflict: 'timestamp'          # timestamp | fail | overwrite

notifications:
  open_result: true                 # mở file .md bằng Notepad khi chạy xong
  open_result_with: 'notepad.exe'
  open_batch_summary: true          # chạy nhiều từ khóa thì mở file tổng kết

performance:
  parallel_steps: false             # workflow luôn chạy tuần tự cố định
  stagger_ms: 1200                  # giữ để tương thích config cũ
  keyword_concurrency: 1            # nhiều từ khóa LUÔN chạy tuần tự

privacy:
  hint_personal_chrome: true        # cảnh báo khi extension đã cài nhầm ở Chrome cá nhân
```

**Không lưu** mật khẩu Google, mật khẩu Ahrefs, cookie hay token trong file YAML.

File `config/selectors.yaml` chứa toàn bộ selector, tách khỏi code. Khi Google hoặc extension đổi giao diện,
chỉ cần sửa file này (và tăng `selector_version` của block tương ứng) mà không phải sửa code.

---

## 7. Kiến trúc và cách hoạt động

```text
CÀI ĐẶT (một lần / mỗi máy)
  install.ps1 ---> git clone / tải ZIP
              ---> Node portable        -> runtime/node/
              ---> scripts/bootstrap.mjs
                        |--- npm install
                        |--- Chrome for Testing -> runtime/chrome/
                        |--- verifyBundle()     -> kiểm tra vendor/extensions/
                        `--- runtime/runtime.lock.json

CHẠY
RUN.bat  ->  src/cli.mjs  ->  src/orchestrator.mjs
                                   |
        +--------------------------+---------------------------+
        |            |             |             |             |
   setup.mjs (cổng kiểm tra extension trước mỗi lần chạy)
        |
   browser/      adapters/     extractors/    output/       core/
   chrome        google-search dom-to-md      markdown      config, logger
   launcher      ai-mode       native-serp    artifact      errors, retry
   cdp           ahrefs-widget paa-dom        validator     sanitize, text
   extension     paa           suggestions    notifier      state-machine
   discovery     suggestions   ahrefs-dom     manifest
   bundled-      serp-export   csv-normalizer
   extensions
```

Thư mục liên quan đến đóng gói:

| Thư mục | Commit? | Nội dung |
| --- | --- | --- |
| `vendor/extensions/` | **Có** | 3 extension giải nén sẵn (~3.7 MB) + `extensions.lock.json` ghi id/version/số tệp |
| `runtime/node/` | Không | Node portable, installer tải theo phiên bản ghim |
| `runtime/chrome/` | Không | Chrome for Testing, installer tải theo phiên bản ghim |
| `config/runtime.json` | **Có** | Phiên bản Node + Chrome ghim cho mọi máy |

Một số quyết định quan trọng:

- **`.bat` chỉ là launcher.** Toàn bộ logic nằm trong Node.js để có thể chờ DOM, retry, ghi log và kiểm tra đầu ra.
- **State machine thay vì script dài.** AI Mode chạy theo máy trạng thái
  `SearchLoaded → OverviewFound → Expanded → PromptBox → Submitted → CopyReady → Captured`
  (nhánh `Missing` khi Google không trả dữ liệu). Orchestrator cũng là một chuỗi step có retry riêng.
- **Native-first:** Suggestions dùng DOM + endpoint; Organic SERP luôn dùng native DOM; Ahrefs chỉ dùng cho dữ liệu riêng của toolbar.
- **Không click tọa độ** vào icon extension trên thanh công cụ Chrome. Tool đọc `manifest.json`
  để tìm `action.default_popup` (MV3) hoặc `browser_action.default_popup` (MV2) rồi mở trang đó.
- **Extension đi kèm repo, không cài tay.** `discoverEffective()` ưu tiên bản đã cài trong profile, thiếu
  thì lấy bản trong `vendor/extensions/` và nạp bằng `--load-extension`. Trường `key` trong manifest
  giữ nguyên extension id nên các URL `chrome-extension://<id>/...` không đổi giữa các máy.
- **Phiên bản runtime được ghim.** Mọi máy chạy cùng một Node và cùng một Chrome for Testing
  (`config/runtime.json`), nên lỗi tái hiện được giữa các máy.
- **Sang Page 2 bằng URL `start=10`** và xác minh lại query param, không dựa vào nút phân trang.
- **Ghi file qua staging + atomic move.** File chỉ xuất hiện trong `output\` sau khi đã ghi xong và đổi tên.
- **Chỉ báo thành công sau khi qua quality gate** (đúng 3 file, đúng 4 heading, CSV parse được bằng parser chuẩn,
  URL hợp lệ, Page 1 ≠ Page 2, không còn file `.tmp`).
- **Cùng một hàm trích xuất chạy ở hai nơi.** Các hàm trong `src/extractors/` là hàm thuần, self-contained;
  chúng được bơm vào trang bằng `page.evaluate()` khi chạy thật và được gọi trực tiếp trên `linkedom`
  khi chạy test — nên luật lọc ads/PAA/AI Overview được test offline.

---

## 8. Test

```bash
npm test
```

hoặc double-click `TEST.bat`.

| Nhóm | Nội dung |
| --- | --- |
| Unit | sanitize tên file Windows, conflict naming, dedupe, CSV parser, markdown builder, validator, extension discovery MV2/MV3, URL builder, state machine, config loader |
| Integration (fixture HTML) | SERP lẫn ads/PAA/video/featured snippet, DOM→Markdown, widget Ahrefs, autocomplete dropdown, popup extension, đường đi artifact staging→output |
| Integration (Chrome thật) | Selector registry qua Playwright locator, `page.evaluate` với extractor ghép source, state machine AI Mode với nội dung streaming, bắt sự kiện download khi bấm Export CSV |
| E2E cục bộ (Chrome thật) | Chạy trọn orchestrator trên server giả lập SERP ở `127.0.0.1`: tạo đủ 3 file, đúng 4 heading, PAA dedupe, suggestions DOM fallback, CSV lọc đúng, manifest nằm ngoài `output\`, chạy lại thì tạo thư mục timestamp |
| Hồi quy từ run thật | Thứ tự workflow, Show more dynamic/stale, `Copy text` của answer, không lấy nhầm `Copy <prompt>`, không nhảy nhầm tab Search Console, gợi ý cá nhân và vị trí Page 2 |
| Cờ legacy & nhiều từ khóa | `--parallel` / `--sequential` đều dùng workflow cố định; hai từ khóa tạo hai thư mục riêng, log tách biệt |
| Extension discovery | Quét được nhiều thư mục profile (`Default`, `Profile N`), báo rõ đã quét những profile nào, phát hiện extension cài nhầm ở Chrome cá nhân |

Các test cần Chrome sẽ **tự động skip** nếu máy không có Chrome.

`SMOKE_TEST.bat` chạy một từ khóa cố định trên Google thật, ghi ra thư mục tạm và báo những block nào
phải dùng fallback — dùng để phát hiện sớm việc Google/extension đổi giao diện.

---

## 9. Giới hạn đã biết

### Đã kiểm chứng bằng một run thật trên Google

Ngày 2026-08-21, keyword `Father’s Day Outfit Ideas`, Chrome 151, **chưa cài extension nào**
(nên toàn bộ đi đường DOM fallback). Kết quả: `COMPLETED_WITH_WARNINGS`, đủ 3 file, 3m36s.

| Khối | Kết quả thật |
| --- | --- |
| AI Mode | Lấy được câu trả lời thật, 3.414 ký tự, giữ đúng heading/bullet/bold |
| People Also Asked | 4 câu hỏi từ DOM Google |
| Search Suggestions | 6 gợi ý từ DOM dropdown |
| CSV Page 1 / Page 2 | 20 / 10 kết quả organic, không lẫn quảng cáo, không có URL `chrome-extension://` |
| Selector | `ai_overview.container` và `ai_overview.show_more` phải dùng fallback → ghi `SELECTOR_DRIFT` |

Run đó phát hiện 3 lỗi thật, **đã sửa và đã có test hồi quy**
(`tests/integration/real-world-regressions.test.mjs`):

1. Gợi ý bị dính chữ `Delete` — khi tài khoản đã đăng nhập, mỗi dòng gợi ý lấy từ lịch sử tìm kiếm có
   kèm một nút xóa nằm bên trong dòng. Nay tool bỏ các nút điều khiển trước khi lấy text
   (`google_suggestions.control_nodes` / `control_words`).
2. Khối UI `Share public link` của AI Mode lọt vào cuối câu trả lời. Nay tool cắt tại mốc UI đầu tiên
   (`ai_prompt_box.response_stop_markers`) và bỏ dòng mời chào cụt ở cuối.
3. Google bỏ qua `num=10` và trả về 20 kết quả ở Page 1, làm Page 2 (đánh số từ 11) chồng lấn Page 1.
   Nay Page 2 đánh số tiếp sau số dòng thật của Page 1, và ghi warning `SERP_MORE_RESULTS_THAN_EXPECTED`.

> Lưu ý: PAA của Google có thể chứa câu hỏi lệch chủ đề (run trên có
> "What makes a woman look wealthy?"). Đó là nội dung Google thực sự hiển thị — tool **không** lọc bớt,
> vì file là snapshot của phiên chạy.

### Chưa kiểm chứng được (cần profile đã cài extension và đăng nhập)

- DOM thật của widget Ahrefs SEO Toolbar, gồm cả khả năng đọc/đổi country. Nếu widget dùng shadow DOM đóng,
  tool sẽ tự chuyển sang đường clipboard (nút `Copy`).
- Selector của AI Overview/AI Mode còn có thể đổi tiếp. Run thật cho thấy selector chính đã lệch và phải
  dùng fallback — hãy chạy `SMOKE_TEST.bat` định kỳ và cập nhật `config/selectors.yaml` khi thấy
  `SELECTOR_DRIFT`.
- Hành vi thật của Google khi gặp CAPTCHA / yêu cầu đăng nhập / trang consent. Run thật ở trên không gặp
  CAPTCHA nên cơ chế pause–resume mới chỉ kiểm chứng được ở mức logic.
- Tiêu chí nghiệm thu "chạy thành công tối thiểu 8/10 keyword test" (mục 16.15 của đặc tả) mới chạy được 1/10.

**Giới hạn thiết kế của MVP:**

- Hỗ trợ nhiều từ khóa ngăn cách bằng `;`, nhưng luôn chạy tuần tự trên cùng profile để tránh lấy nhầm dữ liệu.
- Cố định 2 trang SERP. Đặt `search.pages` khác 2 sẽ bị ghi cảnh báo và vẫn chạy 2 trang, vì output bắt buộc
  đúng 3 file.
- Google không còn tôn trọng `num=10`, nên số dòng Page 1 có thể nhiều hơn 10. Tool giữ nguyên toàn bộ
  kết quả thật thay vì cắt bớt, và đánh số Page 2 tiếp sau Page 1.
- Chế độ `questions_and_answers` của PAA có click mở từng câu hỏi, việc này có thể làm Google nạp thêm dữ liệu
  và thay đổi snapshot. Mặc định là `questions_only`.
- Khi extension tải CSV về thư mục `Downloads` của Windows, tool **copy** file vào kết quả và **không xóa**
  file gốc (tránh xóa nhầm file của người dùng). Đường dẫn file gốc được ghi trong `run.log`.
- `headless: true` chưa được khuyến nghị: AI Mode và extension cần UI thật.
- Output là **snapshot của phiên chạy**. `gl=us&hl=en&pws=0` không đảm bảo mọi người dùng tại US thấy SERP
  giống hệt. AI Mode có thể trả lời khác nhau theo tài khoản và thời điểm.

**Những việc tool cố ý KHÔNG làm:**

- Không tự vượt CAPTCHA, không dùng dịch vụ giải CAPTCHA.
- Không cài stealth plugin, không xoay proxy để né giới hạn.
- Không đọc hay sao chép profile Chrome cá nhân.
- Không tự bịa Keywords Ideas từ nguồn khác khi Ahrefs không hoạt động.
- Không lưu mật khẩu, cookie hay token vào file cấu hình và log.
