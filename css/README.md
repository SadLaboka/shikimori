# Рабочие модули оформления

`base/main_code_3.css` — рабочая копия E-design / ed-main для первого пилота
прямого импорта из этого репозитория. Начальный файл побайтно совпадает с
`vendor/edesign/main_code_3.css`; исходник:
https://raw.githubusercontent.com/ed-main/ed-main.github.io/d54e91b58c7c16def6f73e7289e29f895a984195/cssfiles/main_code_3.css.

SHA256 начального файла:
`2074e255cdd771b188dd901be7e8fcfbc74f30054d50e1e179bd74373d968556`.
Авторство и исходные комментарии сохранены; новая лицензия на стороннюю основу
не назначается. Vendor остаётся неизменным эталоном, рабочие изменения будут
вноситься в `css/` отдельными проверяемыми этапами.

Подключение — прямым абсолютным URL с SHA коммита. Вложенных импортов нет.
Перед заменой источника модуль должен быть отправлен в GitHub и проверен
по реальному удалённому URL. Изменение рабочего файла не обновляет уже
опубликованный commit-URL: нужна новая версия и отдельная публикация CSS.

`base/main_code_2.css` — следующая побайтно одинаковая рабочая копия из
`vendor/edesign/main_code_2.css`, тот же автор E-design / ed-main и upstream-коммит.
SHA256: `da2a492ad16b7f018852b2307508a61b297bc80a191a6f22b31fdd6ac2950f18`.
Подготовка и проверки: [main2](../docs/owned-main2-migration.md).

`base/main_code_1.css` — побайтная рабочая копия `vendor/edesign/main_code_1.css`
того же E-design / ed-main и upstream-коммита, без изменения ресурсов.
SHA256: `6418d0256c575f1244c0b0b42cb5c3cecd43b9de3cd4d2af87a84f948cb84e83`.
Подготовка и особенности серверных URL: [main1](../docs/owned-main1-migration.md).
