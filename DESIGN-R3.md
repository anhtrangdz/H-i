# Sổ Relax R3 — iPhone UI design baseline

R3 được rebuild theo các nguyên tắc từ Apple Human Interface Guidelines hiện hành:

- Layout phải thích nghi với kích thước màn hình, orientation, Dynamic Island/camera housing và safe areas.
- Tôn trọng system margins/safe areas thay vì đặt nội dung sát mép thiết bị.
- Typography dùng system font stack để giữ metric/legibility gần iOS.
- Controls quan trọng dùng touch area lớn; QA không cho phép control xuống dưới ngưỡng tối thiểu 28 pt và các action chính chủ yếu ở khoảng 44 pt trở lên.
- Navigation chính giữ vị trí ổn định; secondary destinations đi vào bottom sheet thay vì desktop sidebar.
- Text entry có keyboard-aware behavior; tab bar rời khỏi vùng thao tác khi editor focus.
- Light/dark scheme dùng system-like semantic colors thay vì hard-code một theme sáng duy nhất.

Apple references used while redesigning:
- https://developer.apple.com/design/human-interface-guidelines/layout
- https://developer.apple.com/design/human-interface-guidelines/accessibility
- https://developer.apple.com/design/human-interface-guidelines/toolbars
- https://developer.apple.com/design/human-interface-guidelines/text-fields
