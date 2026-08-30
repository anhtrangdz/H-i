# R4 Design Notes

Design baseline: iPhone-first, content hierarchy trước chrome, large titles, inset primary actions, grouped settings, bottom navigation, modal sheets, safe areas và keyboard-aware composition.

## Principles

1. **One primary action per view** — các action phụ chuyển thành text/soft controls.
2. **Content under chrome** — artwork và scroll content chạy edge-to-edge; tab bar/toolbar nổi trên content.
3. **Touch geometry** — controls chính tối thiểu khoảng 44 pt; compact controls không dưới QA floor 28 pt.
4. **Responsive by constraints, not model names** — layout theo width/height/orientation và safe area.
5. **Journal is a composition view** — textarea là nội dung trung tâm, autofocus từ compose action, keyboard không được tab bar che.
6. **No fake biometrics promise** — password local là UX auth mặc định trong R4.
7. **Bundled visual identity** — artwork R4 nằm trong app bundle, không phụ thuộc CDN/network.
