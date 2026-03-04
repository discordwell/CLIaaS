# Visual Verification Checklist

## How to Test the UI Enhancements

### Setup
1. Navigate to http://localhost:3000 (or wherever the Easter Egg game is hosted)
2. Enter Konami code (↑↑↓↓←→←→BA or WWSSADADBA) to access the game
3. Start scenario SCA01EA (Ant Mission 1)

---

## Gap #9: Veterancy Chevrons

### Test Steps:
1. **Spawn veteran units** (via developer tools or by killing 3+ ants)
   - Open browser console
   - Run: `window.game.entities.filter(e => e.isPlayerUnit)[0].kills = 2; window.game.entities.filter(e => e.isPlayerUnit)[0].creditKill();`
   - This promotes the first player unit to Veteran

2. **Visual checks**:
   - [ ] **Veteran unit shows 1 SILVER chevron** above the sprite
   - [ ] Chevron is visible even when unit is NOT selected
   - [ ] Chevron stays centered above unit as it moves
   - [ ] Chevron is positioned ~4 pixels above sprite top edge

3. **Spawn elite units**:
   - Run: `window.game.entities.filter(e => e.isPlayerUnit)[0].kills = 5; window.game.entities.filter(e => e.isPlayerUnit)[0].creditKill();`

4. **Visual checks**:
   - [ ] **Elite unit shows 2 GOLD chevrons** above the sprite
   - [ ] Chevrons are spaced ~6 pixels apart (3 pixels from center each)
   - [ ] Gold color matches elite golden glow effect
   - [ ] Chevrons visible for both selected and unselected units

5. **Edge cases**:
   - [ ] Rookie units (0 kills) show NO chevrons
   - [ ] Chevrons don't interfere with health bars
   - [ ] Chevrons render correctly for infantry (small sprites)
   - [ ] Chevrons render correctly for vehicles (larger sprites)

---

## Gap #15: Multi-Portrait Selection Grid

### Test Steps:
1. **Select 2 units** (click first unit, Shift+click second)
   - [ ] Portrait grid appears in bottom-left panel
   - [ ] Shows 2 portraits in 2-column layout
   - [ ] Each portrait has dark background (#1a1a2e)
   - [ ] Each portrait shows HP bar at bottom (green/yellow/red)
   - [ ] Each portrait shows unit type letter in center

2. **Select 5 units** (box-select or Shift+click)
   - [ ] Portrait grid uses 3-column layout
   - [ ] Shows 2 rows (5 units ÷ 3 cols = 2 rows)

3. **Select 10 units**
   - [ ] Portrait grid uses 4-column layout
   - [ ] Shows 3 rows (10 units ÷ 4 cols = 3 rows)

4. **Select 20 units**
   - [ ] Shows maximum 16 portraits
   - [ ] Displays "+4 more" overflow text below grid
   - [ ] Overflow text is gray (#aaa)

5. **HP color checks**:
   - Damage a unit to <50% HP: [ ] HP bar is YELLOW
   - Damage a unit to <25% HP: [ ] HP bar is RED
   - Full HP unit: [ ] HP bar is GREEN

6. **Edge cases**:
   - [ ] Single unit selection shows OLD UI (name + health bar)
   - [ ] Harvester single selection shows ore load bar
   - [ ] Portrait grid replaces old text list completely

---

## Gap #6: Structure Damage Sprites (Verification Only)

### Test Steps:
1. **Build a GUN turret** (Tesla Coil or similar)
2. **Damage it to 51% HP**:
   - [ ] Shows normal sprite frames (0-31)

3. **Damage it to 49% HP**:
   - [ ] Shows damaged sprite frames (64+)
   - [ ] Visible cracks/damage on turret sprite

4. **Build a SAM launcher**
5. **Damage to <50% HP**:
   - [ ] Shows damaged sprite frames (34-67)
   - [ ] Visible smoke/damage effects

6. **Generic buildings** (barracks, refinery):
   - Damage to <50%: [ ] Shows second half of sprite frames
   - [ ] Visual damage indicators (smoke, cracks)

---

## Performance Checks

- [ ] No frame rate drops when 50+ units on screen
- [ ] Chevrons render smoothly during unit movement
- [ ] Portrait grid updates instantly when selection changes
- [ ] No visual glitches or z-fighting

---

## Browser Console Tests

### Veterancy Testing:
```javascript
// Get first player unit
const unit = window.game.entities.filter(e => e.isPlayerUnit)[0];

// Make veteran (3 kills)
unit.kills = 2;
unit.creditKill();
console.log('Veterancy:', unit.veterancy); // Should be 1

// Make elite (6 kills)
unit.kills = 5;
unit.creditKill();
console.log('Veterancy:', unit.veterancy); // Should be 2
console.log('Damage multiplier:', unit.damageMultiplier); // Should be 1.5
```

### Multi-Selection Testing:
```javascript
// Select multiple units via code
const units = window.game.entities.filter(e => e.isPlayerUnit).slice(0, 10);
units.forEach(u => window.game.selectedIds.add(u.id));
console.log('Selected:', window.game.selectedIds.size); // Should be 10
```

---

## Screenshot Locations (for documentation)

Recommended screenshots to capture:
1. Veteran unit with 1 silver chevron (unselected)
2. Elite unit with 2 gold chevrons (unselected)
3. Multiple veterans/elites showing chevron variety
4. Portrait grid with 2 units
5. Portrait grid with 5 units (3-col layout)
6. Portrait grid with 16 units (4-col layout)
7. Portrait grid with 20 units (showing "+4 more")
8. Damaged GUN turret showing damage sprites
9. Damaged SAM launcher showing damage sprites

---

## Known Issues / Limitations

1. **Portrait thumbnails**: Currently show unit type letter (e.g., "V" for vehicle)
   - Future: Replace with actual sprite thumbnails

2. **Chevron positioning**: Fixed offset works for most sprites
   - May need adjustment for very tall units (future enhancement)

3. **Structure damage**: Already implemented and working
   - Just verified correctness, no changes made

---

## Regression Testing

Verify existing features still work:
- [ ] Unit selection (single + multiple)
- [ ] Health bars appear/disappear correctly
- [ ] Yellow veterancy pips still show for selected units
- [ ] Elite golden glow effect still works
- [ ] Structure health bars still work
- [ ] Minimap unit dots still appear
- [ ] Selection brackets still show
- [ ] Move queues still render
