# Lab8 · Trợ lý thực hành KHTN 8

Website demo tiếng Việt: camera hoặc ảnh tải lên → YOLO11 nhận diện dụng cụ → chọn bài học minh họa bằng Gemini → hiển thị bài thực hành và quy tắc an toàn.

## Chạy tại máy cá nhân

Yêu cầu Python 3.10+ và kết nối mạng khi cài gói hoặc gọi Gemini.

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app:app --reload
```

Mở `http://localhost:8000`. Nếu máy dùng lệnh `python` thay `py`, thay lệnh đầu bằng `python -m venv .venv`.

Đặt `GEMINI_API_KEY` trong `.env` để bật Gemini. Không có khóa, ứng dụng vẫn nhận diện và trình bày bài học từ dữ liệu cục bộ. `MODEL_PATH` mặc định là `./my_custom_yolo11_model.pt`; đổi thành `./models/best.pt` khi di chuyển tệp. `GEMINI_MODEL` có thể thay đổi theo mô hình tài khoản của bạn hỗ trợ.

## Dữ liệu bài học

`data/lessons.json` chỉ chứa **dữ liệu minh họa, chưa xác thực SGK**. Trước khi dùng trong lớp, giáo viên cần thay tên bài, mục tiêu, bước thực hiện, quy tắc an toàn và nguồn trích dẫn theo đúng bộ SGK KHTN 8 đang sử dụng. `equipment_aliases` phải khớp tên lớp trong trọng số YOLO (không phân biệt chữ hoa và dấu tiếng Việt). Nếu không khớp, ứng dụng báo chưa có bài phù hợp. Gemini chỉ chọn một bản ghi có sẵn và viết lý do; nội dung bước, mục tiêu và an toàn được lấy nguyên từ dữ liệu cục bộ.

## API

- `GET /api/health`: trạng thái cấu hình cơ bản.
- `POST /api/analyze`: form-data `file` (JPG, PNG, WebP, mặc định tối đa 10 MB). Trả `width`, `height`, `detections` với `box` là `[x1,y1,x2,y2]` theo pixel ảnh gốc, `labels`, `suggestion` và cảnh báo dữ liệu.

Ảnh chỉ được đọc trong bộ nhớ lúc xử lý. Camera tự quét tối đa một yêu cầu mỗi 3 giây; có thể tắt tự quét và chụp thủ công. Camera trong trình duyệt cần `localhost` hoặc HTTPS.

## Giới hạn

Độ chính xác phụ thuộc ảnh và trọng số YOLO. Nhãn trong mô hình chưa được kiểm tra trực tiếp trong môi trường tạo dự án. Các bản ghi minh họa có thể không khớp nhãn thực tế; xem tên lớp của mô hình rồi sửa `equipment_aliases`. Luôn thực hành với giáo viên, nhất là với hóa chất, lửa hoặc thủy tinh.
