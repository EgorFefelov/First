# tools/ — инструменты курса

## remove_bg.py — «обрезатель»

Вырезает фон у сгенерированной картинки и обрезает по содержимому.
На выходе PNG с прозрачностью — готовый спрайт для игры.

Когда применять:
- спрайт героя (после `edit_image` «в полный рост на однотонном фоне»);
- предметы-награды (после генерации на контрастном фоне).

Примеры:

```bash
# шахматный или белый фон (Nano Banana вместо прозрачности рисует шахматку)
python tools/remove_bg.py generated/raw_hero.png projects/game/hero.png

# сплошной контрастный фон (награды генерим на #00ff00)
python tools/remove_bg.py generated/raw_item.png projects/game/items/key.png --color #00ff00
```

Зависимость: Pillow (`pip install Pillow`). Справка: `python tools/remove_bg.py --help`.
