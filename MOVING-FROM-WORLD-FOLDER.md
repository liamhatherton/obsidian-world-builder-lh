# Moving notes out of the World folder

Earlier versions stored notes in `World/`, the same folder the original World Builder plugin uses. Universe Builder now defaults to `UniverseBuilder/` so the two plugins' notes stay separate.

If a vault has Universe Builder notes in `World/`, the plugin asks once per update what to do:

- **Move to UniverseBuilder/ (recommended)** — moves the `Characters`, `Groups`, `Locations`, `Lore` and `Timeline` folders from `World/` into `UniverseBuilder/`, plus `World/Images` (where portraits are imported while the Universe folder is still `World`). Links to moved images are updated. An `Images` folder on its own doesn't trigger the prompt. Anything else in `World/` is left alone. If the move leaves `World/` with no files (empty folders don't count), you're then asked whether to delete it; **Delete** sends it to the trash per Obsidian's *Deleted files* setting, and closing the dialog without choosing asks again next launch. A vault that also has the original plugin's `World/Factions` notes never gets this question. Obsidian keeps links to the moved notes up to date, and the plugin updates its bookmarks, custom ordering and collapsed sections. Files that already exist at the destination are skipped, never overwritten, and listed afterwards
- **Keep World/, ask again next update** — keeps using `World/` and asks again when the next version is installed
- **Keep World/, don't ask again** — keeps using `World/` for good

If the World Builder plugin is installed, the prompt warns that it won't see the notes once they're moved. The prompt doesn't appear when the **Universe folder** setting is a custom folder, or when `World/` has no notes in those five folders.

To move later (for example after choosing *don't ask again*), or to get the delete offer back after choosing *Keep*, run **Move notes out of the World folder** from the command palette.

Folder paths typed into other plugins or notes, such as a Dataview query on `"World"`, aren't changed by the move.
