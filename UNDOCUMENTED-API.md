# Undocumented Obsidian API

Obsidian's public plugin API has no supported way to put its Live Preview editor inside a custom view. The sidebar's inline **Edit** (Live Preview mode) gets one anyway through Obsidian internals. This is the only place the plugin uses undocumented API; everything else uses the public API.

## Where it's used

All of it lives in `src/main.ts`, in the section **"Inline editors (sidebar Edit button)"**, inside the block marked `⚠ UNDOCUMENTED OBSIDIAN API ⚠`:

- `resolveLivePreviewEditorClass()` — builds a throwaway markdown embed with `app.embedRegistry.embedByExtension.md(...)`, sets `embed.editable = true`, calls `embed.showEditor()`, and takes the constructor two prototypes up from `embed.editMode`. That's Obsidian's internal (scrollable) markdown editor class. The result is cached, and `null` means "unavailable".
- `createLivePreviewEditor()` — creates an instance of that class in the expanded card, passing a stand-in "owner" object that mimics the parts of `MarkdownView` the editor expects (`getMode`, `onMarkdownScroll`, `editor`, `file`, ...). It then uses the instance's `set()`, `.editor` / `.cm`, `updateBottomPadding()`, and sets `app.workspace.activeEditor` so editor hotkeys work. It also proxies `app.vault.config` to turn off line numbers and fold arrows in the sidebar.

The caller is `startEditing()` inside `toggleCardExpand()`, which picks the editor based on the `inlineEditor` setting.

This is the same technique the [Kanban plugin](https://github.com/mgmeyers/obsidian-kanban) uses for its card editor (`getEditorClass()` in its `src/main.ts`, and `src/components/Editor/MarkdownEditor.tsx`), also written up as the [Embeddable Markdown Renderer snippet](https://fevol.github.io/obsidian-notes/notes/snippets/embeddable-markdown-renderer/). If an Obsidian update breaks it, Kanban's source is the first place to look for the fix.

## If an Obsidian update breaks it

1. **Automatic fallback.** If the internal editor can't be created (the embed registry or editor class is missing, or construction throws), the plugin logs a warning to the developer console (`Universe Builder: Live Preview editor unavailable ...`) and opens the raw markdown text box instead. Editing keeps working, just without formatting.
2. **Switch it off by hand.** If the editor still appears but misbehaves (wrong layout, keys not working, text not saving correctly), go to **Settings → Universe Builder → Sidebar editor** and choose **Raw markdown**.
3. **Remove it from the code entirely.** To revert to the raw-markdown editor permanently:
   - In `startEditing()` (inside `toggleCardExpand()`), replace the `editor = (... createLivePreviewEditor(...) ...) ?? createRawEditor(...)` assignment with `editor = createRawEditor(body, entry.file, original, keys);`.
   - Delete the `⚠ UNDOCUMENTED OBSIDIAN API ⚠` block: `LivePreviewEditorClass`, `livePreviewEditorClass`, `resolveLivePreviewEditorClass()` and `createLivePreviewEditor()`. Keep `splitFrontmatter()` only if something else still uses it.
   - Optionally remove the `inlineEditor` setting (its field in `UniverseBuilderSettings`, its default in `DEFAULT_SETTINGS`, the line in `loadSettings()`, and the "Sidebar editor" entry in `UniverseBuilderSettingTab.getSettingDefinitions()` / `setControlValue()`) and the `.wb-card-editor-body` / `.wb-card-editor-props` / `.wb-card-editor-label` rules in `styles.css`.
   - Remove the `Scope` and `Component` imports if nothing else uses them.

## The raw-markdown alternative

`createRawEditor()` is the fallback and needs no internals. It's a plain auto-growing `<textarea>` holding the note's **entire file** (frontmatter included), exactly as read with `app.vault.read()`. Save writes the textarea's contents back with `app.vault.modify()`. It follows the same Save / Cancel / one-entry-at-a-time rules and keyboard shortcuts (Ctrl/Cmd+S or Ctrl/Cmd+Enter to save, Esc to cancel, Tab inserts a tab). Because it uses only standard DOM and public API, Obsidian updates can't break it.
