# Universe Builder

A fiction world-building toolkit for Obsidian: characters, locations, groups, lore entries, and timeline events.  This plugin is a fork of World Builder originally authored by wesswart77.  It has been adapted to work well outside of a fantasy setting and instead puts an emphasis on sci-fi.

![Screenshot](universe-builder.jpg)

## Features

- **Characters** — name, role, age, group, ship, home, physical description, personality, goals
- **Locations** — name, type, parent location, description, inhabitants, secrets
- **Groups** — name, type, subsidiary of, alignment, goals, enemies, allies, description
- **Lore Entries** — title, category (history/tech/religion/culture/other), content
- **Timeline Events** — date/era, title, description, linked characters/locations
- **World Sidebar** — tabbed view across all five entry types
- **Bookmarks** — bookmark any entry from its expanded view, and open them all from the **Bookmarks** button beside the sidebar's title
- **Search** — a search bar pinned under the section header on every tab (each tab keeps its own text); type to hide whatever doesn't match, all words must match. Characters are matched on name, group, ship and home; the other tabs on the name and the text of the note

## Settings

Requires Obsidian 1.13.0 or later. Settings are declared with Obsidian's declarative settings API, so both appear in the Settings search box.

- **Universe folder** — where all Universe Builder notes are stored (default: `UniverseBuilder`). Changing it doesn't move existing notes
- **Sidebar editor** — what the Edit button on an expanded entry opens: **Live Preview** (Obsidian's own editor, the default) or **Raw markdown** (a plain text box holding the whole file, frontmatter included). See [Undocumented Obsidian API](https://github.com/liamhatherton/universe-builder/blob/main/UNDOCUMENTED-API.md)

## Privacy

- **Clipboard** — the plugin only writes to the clipboard, and only when you right-click selected text in an expanded card's preview and choose **Copy**. It never reads the clipboard
- **Network** — the plugin makes no network requests
- **Files outside the vault** — read only when you drop or choose an image for a portrait; the image is copied into the vault and nothing outside it is changed

## More documentation

- [Moving notes out of the World folder](https://github.com/liamhatherton/universe-builder/blob/main/MOVING-FROM-WORLD-FOLDER.md) — the one-time prompt that moves notes from `World/` to `UniverseBuilder/` for users of earlier versions
- [Changes from upstream](https://github.com/liamhatherton/universe-builder/blob/main/CHANGES-FROM-UPSTREAM.md) — everything this fork adds or changes compared to the original World Builder
- [Undocumented Obsidian API](https://github.com/liamhatherton/universe-builder/blob/main/UNDOCUMENTED-API.md) — where the sidebar's Live Preview editor relies on Obsidian internals, and what to do if an update breaks it
