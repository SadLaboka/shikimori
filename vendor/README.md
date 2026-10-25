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

`q05_animated_activity_graph.css` — полный исходник ed-main от 25 октября 2026 года:
https://raw.githubusercontent.com/ed-main/ed-main.github.io/master/cssfiles/q05_animated_activity_graph.css.
SHA256: `5402a3ef7af175e6931970fa02ffecfbcd64aa91f4d1fc334fd8795639eb0d07`.
Снимок включает префиксные объявления и четыре определения keyframes;
неподдерживаемые Chromium конструкции не удаляются. Это источник для сверки,
а не второй подключаемый лист. Отчёт: `docs/q05-migration.md`.

`custom_posters.min.css` — неизменённый исходник CSS-club от 25 октября 2026 года:
https://css-club.web.app/css/custom_posters.min.css.
SHA256: `c8925ac43965cf9931ec6bddea528fef2ea57b98880431ba261ec5522cc5212b`.
Десять правил используются в `BEGIN/END LOCAL CUSTOM POSTERS`, без новой лицензии
на сторонний код. Снимок служит для сверки, не подключается второй копией.
Перенос и ограничения проверки — `docs/posters-migration.md`.

`edesign/main_code_2.css` и `edesign/main_code_3.css` — полные исходники ed-main,
полученные 25 октября 2026 года из коммита
`d54e91b58c7c16def6f73e7289e29f895a984195` репозитория
https://github.com/ed-main/ed-main.github.io.
Разрешённые пары URL и SHA256 — `edesign-pins.json`. Файлы служат эталонами,
не подключаются второй копией; авторство остаётся у ed-main, новая лицензия
на сторонний код не назначается. Подробности — `docs/edesign-foundation.md`.
