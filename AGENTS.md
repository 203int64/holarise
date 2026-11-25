# AGENTS.md — Hiến Pháp Tổ Chức, Sản Phẩm, Câu Từ & Kỹ Thuật của HolaRise

Tài liệu này là **nguồn sự thật tối cao (Single Source of Truth)** của repo `HolaRise`. Mọi tài liệu cũ trong `docs/` hoặc `README.md` nếu mâu thuẫn với `AGENTS.md` đều mặc nhiên hết hiệu lực.

---

## 0. Giao Thức Phản Biện & Chưng Cất Trước Khi Làm (Bắt Buộc Dừng Chờ Duyệt)

Trước khi sửa bất kỳ dòng code, schema hay nội dung nào, Agent **BẮT BUỘC** thực hiện 4 bước dưới đây ngay trong hội thoại và **DỪNG CHỜ DUYỆT**:

### 0.1. Giải mã Ý định — Cấm sao chép Lời nháp (Intent Distillation)
Mọi yêu cầu ngắn từ chủ dự án là **đề bài thô (raw brief)**, không phải văn bản xuất bản hay thiết kế cuối cùng. Agent cấm làm "thư ký chép ý" bê nguyên câu nháp hay ví dụ hội thoại vào giao diện, dữ liệu hoặc quy chuẩn; bắt buộc bóc tách động cơ cốt lõi, phản biện độ vênh với người đọc cuối và tự chưng cất thành phương án/ngôn từ sắc gọn nhất.

### 0.2. Đối sánh Thực tế & Thang 4 Bậc Chống Tự Chế Bánh Xe (Zero-Reinvention Hierarchy)
Khi thiết kế tính năng, luồng trải nghiệm hoặc định dạng nội dung mới, bắt buộc khảo sát chuẩn mực thực tế ngoài thị trường và xét từ bậc 1 xuống bậc 4 (chỉ xuống bậc dưới khi bậc trên không đáp ứng được):
1. **Dùng thẳng nền tảng người dùng mở hằng ngày (`0` dòng code):** Nhóm Zalo (giữ nhiệt, nhắc lịch, ghép xe), Google Photos/Drive (chia sẻ ảnh gốc theo link riêng của buổi), Google Calendar, Google Sheets.
2. **Dùng chuẩn gốc của Trình duyệt (`< 20` dòng code):** Ưu tiên HTML/CSS/Web API nguyên bản (`<dialog>`, `details/summary`, CSS `scroll-snap`, `navigator.share`) thay cho thư viện ngoài hoặc JS hiệu ứng nặng.
3. **Học tinh hoa UX đầu ngành nhưng bản địa hóa cho Hòa Lạc:** Chắt lọc bố cục tối giản & tâm lý giảm bùng kèo của các chuẩn sự kiện hiện đại (như *Luma*), nhưng đổi trục định danh và nhắc lịch về **Số điện thoại / Zalo** phù hợp thói quen sinh viên Việt Nam.
4. **Tự viết code riêng (Lựa chọn cuối cùng):** Chỉ viết phần lõi không công cụ miễn phí nào thay thế được, với số dòng tối thiểu.

### 0.3. Phân tích Tác động Hai Chiều (`Hiện tại × Tương lai`)
- **Chiều Hiện tại (Current Blast Radius):**
  1. *Tính nhất quán luồng người dùng:* Có đẻ ra luồng thứ 2 mâu thuẫn với luồng đang chạy không? Trải nghiệm trong trình duyệt nhúng Zalo/Messenger bị thêm hay bớt bước?
  2. *Đồng bộ 3 tầng (`Static Build` ↔ `Edge SSR` ↔ `D1 Production`):* Chỉ rõ thay đổi chạm tầng nào để tránh lệch giữa bản build tĩnh cục bộ và bản SSR trên Cloudflare.
  3. *Chi phí vận hành & Luật `1 vào = 1 ra`:* Đội điều phối phải làm thêm thao tác thủ công nào? Thành phần/CSS/JS cũ nào được hợp nhất hoặc xóa bỏ tương ứng?
- **Chiều Tương lai (Future Trajectory & Lock-in):**
  1. *Tái sử dụng tự động:* Giải pháp phải chạy chung cho sự kiện thứ 2, thứ 10, thứ 50 (kể cả khi tạo từ `/admin`); **cấm tuyệt đối** fix cứng ID/đường dẫn một sự kiện đơn lẻ vào logic dùng chung.
  2. *Độ mở tổ chức:* Đón nhận tự nhiên khi cả 3 trụ cột và mạng lưới CLB/đối tác cùng hoạt động mà không phải đập đi xây lại.
  3. *An toàn chuyển đổi:* Đổi URL bắt buộc kèm `301` tại `functions/_middleware.js`; thay đổi D1 schema phải tương thích ngược với dữ liệu đang chạy trên production.

### 0.4. Phủ quyết & Chốt chặn Duyệt
Nếu yêu cầu vi phạm các tầng khóa bên dưới hoặc có chi phí vận hành lớn hơn lợi ích thực, Agent **phải phủ quyết** và đặt cạnh ít nhất 1 phương án tinh gọn hơn. Chỉ chạm vào file sau khi chủ dự án duyệt rõ ràng.

---

## 1. Bản Sắc Tổ Chức, Tầm Vóc & Phân Vai Hệ Sinh Thái

- **Bản chất & Tầm vóc (`Khởi nguồn Hòa Lạc · Sứ mệnh Mở rộng`):** **HolaRise** là tổ chức cộng đồng / sáng kiến xã hội phi lợi nhuận khởi nguồn tại Hòa Lạc, đồng hành cùng thế hệ trẻ qua 3 trụ cột gắn kết: **HolaHeart** (tĩnh tại nội tâm, lắng nghe & gia đình), **HolaGreen** (sinh thái & cảnh quan bền vững), và **HolaConnect** (tri thức, tủ sách thiếu nhi & phụng sự cộng đồng), đóng góp thiết thực vào các Mục tiêu Phát triển Bền vững (**UN SDGs**). *Hòa Lạc là cái nôi khởi phát và thao trường thực chứng đầu tiên — nhưng hệ giá trị và sứ mệnh của HolaRise không đóng khung trong một địa giới, mà đi cùng người trẻ và các đối tác đến mọi vùng đất trên hành trình trưởng thành.*
- **Đối tượng trọng tâm:** Khởi đầu từ sinh viên các trường đại học tại Hòa Lạc (ĐH FPT, ĐHQGHN Hòa Lạc...) và thanh niên đi làm tại KCNC Hòa Lạc làm lực lượng nòng cốt, kết nối mở rộng cùng mạng lưới nhà trường, không gian văn hóa và tổ chức xã hội trong và ngoài Hòa Lạc.
- **North Star:**
  > *Đưa một người trẻ từ lúc mở link trong Zalo → cảm nhận chiều sâu và tin tưởng trong 15 giây → giữ chỗ không rào cản → có mặt thật ngoài đời → mang về kỷ niệm đẹp và chủ động rủ bạn đồng hành chặng tiếp theo.*
- **Phân vai Website (`holarise.org`) ↔ Kênh Cộng đồng:**
  - Website đảm nhiệm 3 vai trò: **(1) Trang Thư mời Sự kiện (`/su-kien/<slug>`) & Giữ chỗ nhanh không mật khẩu**, **(2) Hồ sơ uy tín, tầm nhìn xã hội & chuẩn mực minh bạch của tổ chức**, **(3) Kho ký ức chọn lọc (`/hanh-trinh/`) & Cổng kết nối đồng tổ chức**.
  - Mọi tương tác giữ nhiệt thường nhật, ghép xe, nhắc trước giờ G và trả album ảnh gốc phân giải cao diễn ra qua **Nhóm Zalo & liên kết lưu trữ riêng của từng buổi** — không ép người tham dự tạo tài khoản để đăng nhập web hằng ngày.

---

## 2. Tầng 1 — Khóa Chiến Lược, Trải Nghiệm & Ngôn Ngữ Quốc Tế (Product & i18n Gate)

Mọi tính năng hoặc trang mới phải vượt qua **cả 3 phép thử phủ quyết** (trượt 1 = **Không triển khai**):
1. **Zalo In-App Speed Test:** Mở trong WebView của Zalo/Messenger trên mạng di động có mượt và hoàn tất thao tác chính dưới `60 giây` không? (Không phụ thuộc cơ chế đăng nhập bị chặn trong WebView như Google OAuth `disallowed_useragent`).
2. **Operational Sustainability Test:** Đội ngũ tình nguyện có duy trì đều đặn quy trình này suốt nhiều tháng mà không kiệt sức vì nhập liệu kép hay kiểm duyệt thủ công không?
3. **Verifiable Reality Test:** Tính năng/hình ảnh có dựa trên hoạt động đã hoặc sắp diễn ra thật tại Hòa Lạc không? (Mảng chưa triển khai ghi rõ trạng thái chuẩn bị khởi động, cấm lấy ảnh AI đóng giả tư liệu hoạt động thật).

### Danh mục Cấm Đẻ Thêm & Thu Hẹp Nợ Kỹ Thuật
- **Tài khoản Thành viên Mở (Progressive Account — Không Cản Khách Mới):** Hệ thống **có Tài khoản Thành viên chính thức** (`/tham-gia/` & Thẻ Thành Viên `/tv/[code]`) để người trẻ giữ chỗ 1 chạm, xem lại lịch sử tham dự, mở khóa album ảnh gốc và lưu nhật ký cảm nhận dài hạn. Tuy nhiên, **cấm dựng tường đăng nhập bắt buộc** chặn người mới đăng ký sự kiện lần đầu từ Zalo — khách mới luôn có thể giữ chỗ trong `15 giây` chỉ bằng `Tên + SĐT/Zalo`, sau đó mới gợi ý kích hoạt Tài khoản Thành viên để gắn bó lâu dài.
- **Cấm mã vé/mã vạch trang trí giả** không gắn với bản ghi check-in thực tế.
- **Cấm hiệu ứng hijack scroll, cuộn ngang cưỡng bức nhiều màn hình, hoặc PWA Service Worker precache nặng** gây giật trên điện thoại tầm trung hoặc lưu nhầm giờ/địa điểm cũ sát giờ sự kiện.
- **Chuẩn Ngôn ngữ Quốc tế — Cấm song ngữ chắp vá:** Tuyệt đối cấm pha trộn 30% tiếng Anh – 70% tiếng Việt trên cùng một trang hoặc fix cứng bản dịch trong JS tách rời dữ liệu gốc. Giao diện hoạt động thường nhật dùng **100% tiếng Việt chuẩn mực**; hồ sơ đối ngoại quốc tế tách riêng thành trang **`/en/` hoàn chỉnh 100% bằng tiếng Anh** (và ghi chú rõ ngôn ngữ diễn ra của từng sự kiện).

---

## 3. Tầng 2 — Khóa Bút Pháp: Tinh Tuyển, Sức Nặng, Giàu Hình Ảnh & Gần Gũi (Copy & Craft Gate)

### Hệ Thẩm Mỹ Ngôn Từ & Quy Tắc Phân Bổ `30 / 70`
- **Đại từ & Thái độ ("Ngang tầm bàn gỗ — Đĩnh đạc mà Thân tình"):** Tuyệt đối bỏ lối xưng hô suồng sã kiểu hội nhóm tự phát (*"tụi mình"*). Dùng **`chúng mình` / `Hola` – `bạn`** khi trò chuyện, mời gọi người trẻ tham dự; dùng **`chúng tôi` / `HolaRise`** ở tuyên bố sứ mệnh, minh bạch và đối ngoại tổ chức.
- **Bút pháp "Sang Thật — Điện ảnh & Chạm giác quan" (`30%` Vùng Cảm xúc: Hero, Triết lý, Lời dẫn Thư mời, Mở bài Hành trình):** Dùng từ thuần Việt tinh tuyển kết hợp từ Hán–Việt đĩnh đạc đặt đúng điểm rơi; mượn ánh sáng, thiên nhiên và dáng hình con người hữu hình (*khởi nguồn, tĩnh tại, mạch ngầm, buổi sớm sườn đồi, tán thông, mặt nước phẳng lặng, ánh đèn vàng, mặt bàn gỗ, dáng lưng trầm mặc*) để chở tư tưởng lớn. Mỗi đoạn chỉ đặt **1–2 hình ảnh đắt giá nhất**, tiết chế tính từ trang trí và bỏ dấu chấm than `!` hô hào.
- **Bút pháp "Biên bản Chuẩn xác" (`70%` Vùng Hành động: Thời gian, Địa điểm, Chi phí, Biểu mẫu, FAQ, Chính sách):** Không ẩn dụ văn hoa; dùng câu gãy gọn (`<= 22` chữ/câu), chuẩn xác từng con số và dữ kiện để tạo uy tín tuyệt đối.

### 4 Cổng Kiểm duyệt Câu chữ Bắt buộc (Trượt 1 cổng = Biên tập lại)
1. **Cổng Diệt "Sang Giả" & Khẩu hiệu Rỗng (Concrete Evocation over Purple Prose & AI Slop):** Cấm ghép từ Hán–Việt kêu rỗng hoặc ẩn dụ sướt mướt không có cảnh thực (*"kiến tạo di sản"*, *"bức tranh muôn màu"*, *"giữa nhịp sống số hối hả..."*, *"khoảng lặng cần thiết"*, *"điểm tựa cảm xúc"*, *"cùng tần số"*); cấm giọng bề trên dạy bảo, câu tự thanh minh yếu thế (*"không bán khóa học ẩn"*, *"không giáo điều"*), và thuật ngữ kỹ thuật lộ ra giao diện công khai.
2. **Cổng Tự nhiên & Sạch Chính tả (Anti-Cringe):** Cấm nhồi tiếng lóng mạng xã hội gượng ép, cố tình viết sai chính tả, hoặc lặp từ sến (*"che chở, chở che"*). Đọc thành tiếng phải có nhịp điệu điềm tĩnh, sang và thuận tai.
3. **Cổng Thực địa, Không bó hẹp Địa phương & An toàn:** Không đóng khung lý tưởng của HolaRise "chỉ vì Hòa Lạc", nhưng tại mỗi buổi gặp thực địa phải ghi rõ tên/vai trò thật của người dẫn dắt và địa mốc cụ thể, không hứa tần suất vượt thực tế. Mọi nội dung liên quan khu vực **hồ Tân Xã / đập Quán Trăn** chỉ đề cập tuyến đường bộ và không gian công cộng an toàn trên bờ, tuyệt đối không gợi ý hoạt động sát mép nước sâu.
4. **Cổng Thấu cảm với Người đi lần đầu:** Mọi thư mời sự kiện phải làm rõ ngay màn hình đầu 4 điều: *(a) Đi một mình có người đón và không ép phát biểu*, *(b) Chi phí cụ thể bằng con số rõ ràng*, *(c) Hướng dẫn di chuyển/ghép xe thuận tiện*, *(d) Hành động ngay sau khi giữ chỗ (Lưu lịch & Vào Nhóm Zalo buổi gặp)*.

---

## 4. Tầng 3 — Đạo Đức Truyền Thông, An Toàn & Minh Bạch Tổ Chức Xã Hội (NGO Safeguarding)

1. **Đạo đức Kể chuyện & An toàn Tâm lý – Trẻ em (Ethical Storytelling & Safeguarding):**
   - Không đăng ảnh cận mặt người tham dự đang khóc/xúc động mạnh tại `HolaHeart` để câu tương tác; không chụp ảnh hay viết bài theo lối "ban phát từ thiện" ở `HolaConnect`; không công khai cận mặt hoặc thông tin định danh trẻ vị thành niên khi chưa có sự đồng thuận của phụ huynh/nhà trường.
   - Các vòng tròn `HolaHeart` là **không gian chia sẻ đồng đẳng**, không phải tham vấn hay trị liệu tâm lý lâm sàng; cấm dùng ngôn từ chẩn đoán tâm lý hoặc hứa hẹn chữa trị sang chấn/trầm cảm.
2. **Kỷ luật Minh bạch Nguồn lực (In-Kind First & Open Traceability):**
   - Khi chưa có pháp nhân quỹ độc lập, ưu tiên nhận đồng hành bằng *không gian, sách, cây giống, học cụ* hoặc thành viên tự chi trả phần cá nhân trực tiếp tại điểm hẹn; không lập quỹ thu tiền mặt tự phát qua tài khoản cá nhân mập mờ. Mọi nguồn lực tiếp nhận cho một chiến dịch phải đối soát kết quả bàn giao ngay trong bài tổng kết chiến dịch đó.
3. **Chỉ số Tác động Kiểm chứng (Verified Outcomes Only):**
   - Chỉ công bố số liệu đếm thật tại hiện trường (số người thực sự có mặt check-in, số đầu sách đưa vào tủ sách hoạt động, khối lượng rác phân loại bàn giao đúng điểm thu gom, tỷ lệ người trẻ quay lại). Chưa có số thật thì để trống; cấm dùng lượt xem hay số ước lượng làm tròn.
4. **Bảo vệ Dữ liệu Cá nhân & Tâm sự Ẩn danh (Chuẩn Nghị định 13/2023/NĐ-CP):**
   - Thu thập tối thiểu trường thông tin cần cho buổi gặp; tách bạch tuyệt đối danh tính/SĐT khỏi các chia sẻ người tham dự chọn gửi ẩn danh; cấm để lộ SĐT/email thành viên qua API công khai (bao gồm lỗi dò tài khoản *Account Enumeration*) hoặc tài liệu mở.

---

## 5. Khung Kỹ Thuật, Bẫy Ngầm Repo & Cổng Nghiệm Thu

- **Tech Stack & Thư viện ngoài:** Python 3 stdlib qua `build.py` (`data/*.json` + `templates/*.html` + `assets/` → `dist/`), Cloudflare Pages Functions (`functions/`), cơ sở dữ liệu **Cloudflare D1 (`DB`, `migrations/`)**, lưu trữ ảnh hiển thị web (`<= 1280px`) trên **Workers KV (`MEDIA_KV`)**, đồng bộ ngoài qua Google Apps Script (`functions/_lib/gas.js`). Được phép thêm thư viện ngoài gọn nhẹ (ưu tiên tự host tại `assets/vendor/` và nạp trễ *lazy-load* khi không cần ngay lúc mở trang) nếu mang lại giá trị trải nghiệm rõ rệt mà chuẩn gốc trình duyệt chưa đáp ứng được; tại mỗi thời điểm chỉ giữ tối đa `1` bản kế hoạch đang chạy (`docs/ACTIVE-PLAN.md`), tài liệu cũ lưu vào `docs/_archive/`.
- **Bẫy Kỹ thuật Ngầm & Vùng Cấm Sửa Tay (Repo Gotchas):**
  1. **Cấm sửa tay `dist/*`:** `dist/` là đầu ra sinh tự động nhưng được commit lên Git để phục vụ Cloudflare Pages; mọi thay đổi ở `data/`, `templates/`, `assets/` bắt buộc chạy lại `python3 build.py --check` để đồng bộ `dist/`.
  2. **Bảo toàn điểm neo Edge SSR:** Cấm xóa hoặc đổi tên các cặp comment `<!-- CMS:...:START -->` / `<!-- CMS:...:END -->` trong `templates/*.html` khi chưa cập nhật khớp với `functions/_lib/render.js`.
  3. **Ràng buộc Link-Checker tĩnh:** Mọi đường dẫn tĩnh `href="/..."` và `src="/..."` (ngoài `/api/*`) đều bị `build.py --check` đối chiếu sự tồn tại thật trong `dist/`.
  4. **Bất biến D1 Migration & Đồng bộ Công cụ:** Chỉ thêm file `migrations/000X_*.sql` đánh số nối tiếp, cấm sửa lùi migration cũ đã chạy trên production; giữ symlink `CLAUDE.md -> AGENTS.md` để mọi công cụ AI đọc chung một nguồn luật.
- **Bất biến Bảo mật:** Escape toàn bộ dữ liệu động khi SSR (`functions/_lib/render.js`) chống XSS; kiểm tra session hợp lệ + header `Origin` chống CSRF (`functions/_lib/security.js`) cho mọi request ghi tại `/api/admin/*`; giữ honeypot và rate-limit trên biểu mẫu công khai.
- **Cổng Nghiệm thu 3 Bước Bắt buộc (PASS cả 3 mới được coi là hoàn thành):**
  1. `python3 build.py --check` (gồm cả kiểm tra `[COPY-WARN]` / `--strict-copy`)
  2. `node --test tests/*.test.mjs`
  3. Đối chiếu toàn bộ thay đổi qua **Tầng 1, Tầng 2 & Tầng 3** (`0` pha tạp ngôn ngữ nửa vời, `0` văn sáo rỗng/tự thanh minh, `0` ảnh AI giả tư liệu thật, `0` rò rỉ dữ liệu cá nhân).
