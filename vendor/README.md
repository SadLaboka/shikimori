# Зафиксированные сторонние исходники

`profile-content-layout-v1.css` — неизменённый снимок CSS-club, полученный
24 октября 2026 года из
https://css-club.web.app/css/profile-content-layout-v1.css.

SHA256: `415e19f2662a95f24ca65d2bf3c47893e4a680b57c6da0dc082f7e6c80ec9022`.

Это источник для сравнения, а не дополнительный подключаемый CSS.
Те же десять правил перенесены в начало пользовательской части
`styles_optimized.css`, между `BEGIN/END LOCAL PROFILE LAYOUT`.
Проверка Playwright сравнивает снимок с текущим импортированным блоком по CSSOM
и отказывается от миграции при расхождении. Авторство исходного оформления
остаётся у CSS-club; новая лицензия на сторонний код здесь не назначается.

`q03_history_bookmarks.css` — исходный файл ed-main, полученный 24 октября 2026 года:
https://raw.githubusercontent.com/ed-main/ed-main.github.io/master/cssfiles/q03_history_bookmarks.css.
SHA256: `197685dbb20d096a80fd00aff87bada58dbeaccba303f5c0b6d782ceb6bc4666`.
Семь правил перенесены без оптимизации в `BEGIN/END LOCAL HISTORY BOOKMARKS`.
Отдельное совместимостное объявление после блока сохраняет прежний приоритет
`content` постера подсказки; оно не выдаётся за часть исходника ed-main.
