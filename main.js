var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => UniverseBuilderPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
function getMarkdownFilesIn(app, folderPath) {
  const folder = app.vault.getAbstractFileByPath((0, import_obsidian.normalizePath)(folderPath));
  if (!(folder instanceof import_obsidian.TFolder)) return [];
  const out = [];
  import_obsidian.Vault.recurseChildren(folder, (f) => {
    if (f instanceof import_obsidian.TFile && f.extension === "md") out.push(f);
  });
  return out;
}
var DEFAULT_FOLDER = "UniverseBuilder";
var LEGACY_FOLDER = "World";
var WORLD_BUILDER_ID = "world-builder";
var DEFAULT_SETTINGS = {
  worldFolder: DEFAULT_FOLDER,
  characterOrder: {},
  collapsedGroups: [],
  collapsedGroupTypes: [],
  collapsedParents: [],
  collapsedSubsidiaries: [],
  sectionOrder: {},
  bookmarks: [],
  collapsedBookmarkGroups: [],
  inlineEditor: "live",
  folderMigration: {}
};
var GROUP_TYPES = [
  { key: "corporation", label: "Corporation" },
  { key: "government", label: "Government" },
  { key: "military", label: "Military" },
  { key: "criminal", label: "Criminal" }
];
function slugify(s) {
  return s.replace(/[/\\:*?"<>|#^[\]]/g, "-").trim();
}
var SUBSIDIARY_OF = "subsidiary-of";
function isShip(fm) {
  var _a;
  return ((_a = fm.type) != null ? _a : "").trim().toLowerCase() === "ship";
}
var IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
var SIZE_SPEC = /^\d+(x\d+)?$/;
var SHOW_NAV_BUTTONS = false;
var FLOAT_GAP = 20;
var FLOAT_GAP_BOTTOM = FLOAT_GAP + 18;
var FLOAT_MS = 220;
var IMAGES_SUBFOLDER = "Images";
function migratedFolderNames() {
  return [...SECTION_TABS.map((tab) => SECTION_LABELS[tab]), IMAGES_SUBFOLDER];
}
function imagesFolderPath(worldFolder) {
  return (0, import_obsidian.normalizePath)(`${worldFolder}/${IMAGES_SUBFOLDER}`);
}
function portraitFolderFor(worldFolder, notePath) {
  const root = (0, import_obsidian.normalizePath)(worldFolder);
  const images = imagesFolderPath(worldFolder);
  const path = (0, import_obsidian.normalizePath)(notePath);
  if (!path.toLowerCase().startsWith(root.toLowerCase() + "/")) return images;
  const first = path.slice(root.length + 1).split("/")[0].toLowerCase();
  const section = SECTION_TABS.map((tab) => SECTION_LABELS[tab]).find((label) => label.toLowerCase() === first);
  return section ? `${images}/${section}` : images;
}
async function ensureFolderPath(app, path) {
  let current = "";
  for (const part of (0, import_obsidian.normalizePath)(path).split("/")) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
  }
}
function draggedVaultImage(app) {
  var _a, _b;
  const draggable = (_a = app.dragManager) == null ? void 0 : _a.draggable;
  if (!draggable) return null;
  const candidates = draggable.type === "file" ? [draggable.file] : draggable.type === "files" ? (_b = draggable.files) != null ? _b : [] : [];
  for (const f of candidates) if (f instanceof import_obsidian.TFile && IMG_EXT.test(f.name)) return f;
  return null;
}
function vaultFileForDropped(app, dropped) {
  var _a, _b, _c, _d;
  const adapter = app.vault.adapter;
  if (!(adapter instanceof import_obsidian.FileSystemAdapter)) return null;
  let osPath = "";
  try {
    const electron = (_a = window.require) == null ? void 0 : _a.call(window, "electron");
    osPath = ((_c = (_b = electron == null ? void 0 : electron.webUtils) == null ? void 0 : _b.getPathForFile) == null ? void 0 : _c.call(_b, dropped)) || dropped.path || "";
  } catch (e) {
    osPath = (_d = dropped.path) != null ? _d : "";
  }
  if (!osPath) return null;
  const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = norm(adapter.getBasePath());
  const full = norm(osPath);
  if (!full.toLowerCase().startsWith(base.toLowerCase() + "/")) return null;
  const found = app.vault.getAbstractFileByPath((0, import_obsidian.normalizePath)(full.slice(base.length + 1)));
  return found instanceof import_obsidian.TFile ? found : null;
}
function isImageDrag(app, e) {
  var _a;
  const dt = e.dataTransfer;
  if (!dt || dt.types.includes("application/x-wb-card")) return false;
  if (dt.types.includes("Files")) {
    const items = Array.from((_a = dt.items) != null ? _a : []);
    return items.length === 0 || items.some((i) => i.kind === "file" && (i.type === "" || i.type.startsWith("image/")));
  }
  return draggedVaultImage(app) !== null;
}
function droppedImageFrom(app, dt) {
  if (dt.types.includes("Files")) return imageFromFiles(app, Array.from(dt.files));
  const vaultFile = draggedVaultImage(app);
  return vaultFile ? { kind: "vault", file: vaultFile } : null;
}
function imageFromFiles(app, files) {
  if (files.length === 0) return null;
  const picked = files.find((f) => IMG_EXT.test(f.name));
  if (!picked) {
    new import_obsidian.Notice(files.length === 1 ? `"${files[0].name}" isn't an image.` : "None of those files is an image.");
    return null;
  }
  const inVault = vaultFileForDropped(app, picked);
  return inVault ? { kind: "vault", file: inVault } : { kind: "external", file: picked };
}
function sameBytes(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
async function importImage(app, worldFolder, file, notePath) {
  const folder = portraitFolderFor(worldFolder, notePath);
  await ensureFolderPath(app, folder);
  const data = await file.arrayBuffer();
  const dot = file.name.lastIndexOf(".");
  const stem = slugify(dot > 0 ? file.name.slice(0, dot) : file.name) || "image";
  const ext = (dot > 0 ? file.name.slice(dot + 1) : "png").toLowerCase();
  const folderObj = app.vault.getAbstractFileByPath(folder);
  const siblings = /* @__PURE__ */ new Map();
  if (folderObj instanceof import_obsidian.TFolder) {
    for (const child of folderObj.children) if (child instanceof import_obsidian.TFile) siblings.set(child.name.toLowerCase(), child);
  }
  for (let n = 0; ; n++) {
    const name = n === 0 ? `${stem}.${ext}` : `${stem} ${n}.${ext}`;
    const clash = siblings.get(name.toLowerCase());
    if (!clash) return await app.vault.createBinary(`${folder}/${name}`, data);
    if (clash.stat.size === data.byteLength && sameBytes(await app.vault.readBinary(clash), data)) return clash;
  }
}
function portraitEmbed(app, image, notePath, size = "") {
  const link = app.fileManager.generateMarkdownLink(image, notePath, void 0, size || void 0);
  return link.startsWith("!") ? link : `!${link}`;
}
function insertAtBodyTop(data, embed) {
  const bodyStart = data.length - stripFrontmatterBlock(data).length;
  let head = data.slice(0, bodyStart);
  if (head && !head.endsWith("\n")) head += "\n";
  return `${head}${embed}
${data.slice(bodyStart)}`;
}
function stripFrontmatterBlock(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "");
}
function stripLeadingHeading(markdown) {
  var _a;
  const lines = markdown.replace(/^\s+/, "").split("\n");
  if (!/^#\s+\S/.test((_a = lines[0]) != null ? _a : "")) return markdown;
  lines.shift();
  while (lines[0] === "") lines.shift();
  return lines.join("\n");
}
function openImageZoom(src, alt) {
  var _a;
  (_a = document.querySelector(".wb-zoom-overlay")) == null ? void 0 : _a.remove();
  const overlay = document.body.createDiv({ cls: "wb-zoom-overlay", attr: { role: "dialog", "aria-modal": "true", "aria-label": alt || "Image" } });
  const img = overlay.createEl("img", { cls: "wb-zoom-img", attr: { src, alt, draggable: "false" } });
  let scale = 1;
  let x = 0;
  let y = 0;
  const apply = () => {
    img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    overlay.toggleClass("is-zoomed", scale > 1);
  };
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener("keydown", onKey, true);
  overlay.addEventListener("wheel", (e) => {
    e.preventDefault();
    const prev = scale;
    scale = Math.min(10, Math.max(1, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    if (scale === 1) {
      x = 0;
      y = 0;
    } else {
      const cx = e.clientX - window.innerWidth / 2;
      const cy = e.clientY - window.innerHeight / 2;
      x = cx - (cx - x) * scale / prev;
      y = cy - (cy - y) * scale / prev;
    }
    apply();
  }, { passive: false });
  let dragStart = null;
  let moved = false;
  overlay.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragStart = { mx: e.clientX, my: e.clientY, x, y };
    moved = false;
    overlay.setPointerCapture(e.pointerId);
  });
  overlay.addEventListener("pointermove", (e) => {
    if (!dragStart) return;
    const dx = e.clientX - dragStart.mx;
    const dy = e.clientY - dragStart.my;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    if (scale > 1) {
      overlay.addClass("is-panning");
      x = dragStart.x + dx;
      y = dragStart.y + dy;
      apply();
    }
  });
  overlay.addEventListener("pointerup", () => {
    overlay.removeClass("is-panning");
    const wasClick = dragStart && !moved;
    dragStart = null;
    if (wasClick) close();
  });
  img.onerror = close;
}
async function ensureFolder(app, path) {
  if (!app.vault.getAbstractFileByPath(path)) {
    await app.vault.createFolder(path);
  }
}
async function createNote(app, folder, filename, content) {
  await ensureFolder(app, folder);
  const path = `${folder}/${slugify(filename)}.md`;
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof import_obsidian.TFile) {
    await app.vault.modify(existing, content);
    return existing;
  }
  return await app.vault.create(path, content);
}
function readFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    let value = line.slice(idx + 1).trim();
    if (value.length >= 2 && (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[line.slice(0, idx).trim()] = value;
  }
  return result;
}
function labeledLine(pairs) {
  return pairs.filter(([, value]) => value).map(([label, value]) => `${label}:\xA0${value}`).join(" \u2022 ");
}
function normalizeForSearch(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
function parseRefName(raw) {
  const trimmed = raw.trim();
  const m = trimmed.match(/^\[\[([^\]]+)\]\]$/);
  const inner = m ? m[1] : trimmed;
  return inner.split("|")[0].split("#")[0].trim();
}
function documentSearchText(content, fm) {
  const body = stripFrontmatterBlock(content).replace(/!\[\[[^\]]*\]\]/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1").replace(/\[\[([^\]]*)\]\]/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, " ");
  const values = Object.entries(fm).filter(([key]) => key !== "entry_type").map(([, value]) => value);
  return [...values, body].join(" ");
}
var hasValue = (v) => v !== void 0 && v !== null && !(typeof v === "string" && v.trim() === "");
var SECTION_TABS = ["characters", "locations", "groups", "lore", "timeline"];
var SECTION_LABELS = {
  characters: "Characters",
  locations: "Locations",
  groups: "Groups",
  lore: "Lore",
  timeline: "Timeline"
};
var SEARCH_HINTS = {
  characters: { noun: "characters", tip: "Matches name, group, ship and home" },
  locations: { noun: "locations", tip: "Matches the name and the text of the note" },
  groups: { noun: "groups", tip: "Matches the name and the text of the note" },
  lore: { noun: "lore", tip: "Matches the title and the text of the note" },
  timeline: { noun: "timeline", tip: "Matches the title and the text of the note" },
  bookmarks: { noun: "bookmarks", tip: "Matches each bookmark the same way its own tab does" }
};
function buildParentTree(entries, getParentName, getOwnName) {
  const nameIndex = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    const key = normalizeForSearch(parseRefName(getOwnName(entry.fm) || ""));
    if (key && !nameIndex.has(key)) nameIndex.set(key, entry);
  }
  const parentOf = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    const raw = parseRefName(getParentName(entry.fm) || "");
    if (!raw) continue;
    const parent = nameIndex.get(normalizeForSearch(raw));
    if (parent && parent.file.path !== entry.file.path) parentOf.set(entry.file.path, parent);
  }
  const isAcyclic = (start) => {
    const seen = /* @__PURE__ */ new Set();
    let cur = start;
    while (cur) {
      if (seen.has(cur.file.path)) return false;
      seen.add(cur.file.path);
      cur = parentOf.get(cur.file.path);
    }
    return true;
  };
  for (const entry of entries) {
    if (parentOf.has(entry.file.path) && !isAcyclic(entry)) parentOf.delete(entry.file.path);
  }
  const childrenOf = /* @__PURE__ */ new Map();
  const roots = [];
  for (const entry of entries) {
    const parent = parentOf.get(entry.file.path);
    if (!parent) {
      roots.push(entry);
      continue;
    }
    const list = childrenOf.get(parent.file.path);
    if (list) list.push(entry);
    else childrenOf.set(parent.file.path, [entry]);
  }
  return { roots, childrenOf };
}
function mergeGroupOrder(overall, groupPaths, newGroupOrder) {
  const groupSet = new Set(groupPaths);
  const result = [];
  let inserted = false;
  for (const path of overall) {
    if (groupSet.has(path)) {
      if (!inserted) {
        result.push(...newGroupOrder);
        inserted = true;
      }
    } else {
      result.push(path);
    }
  }
  if (!inserted) result.push(...newGroupOrder);
  return result;
}
var VIEW_TYPE = "universe-builder-sidebar";
var UniverseBuilderView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.activeTab = "characters";
    /** What is typed in the search bar for each tab; kept here so it survives a redraw (Reload, new note, ...). */
    this.searchQueries = { characters: "", locations: "", groups: "", lore: "", timeline: "", bookmarks: "" };
    /** The section tab to return to when the Bookmarks button is clicked again while viewing bookmarks. */
    this.lastSectionTab = "characters";
    /** How each section draws its cards, captured in renderSection() so the Bookmarks view can draw them the same way. */
    this.sectionConfigs = {};
    /** The Bookmarks button in the title row, highlighted while the Bookmarks view is open. */
    this.bookmarkHeaderButtons = [];
    this.searchTargets = {};
    /** Normalised text each card is matched against. */
    this.searchIndex = /* @__PURE__ */ new WeakMap();
    /** Every note currently drawn in the sidebar, keyed by path, so a wiki-link click can find its entry. */
    this.entryByPath = /* @__PURE__ */ new Map();
    /** Tabs whose lists nest child entries under their parent (see renderHierarchicalGroup). */
    this.hierarchicalTabs = /* @__PURE__ */ new Set(["locations"]);
    /** Un-collapses one hierarchical parent's subtree, keyed by the parent's note path (used by revealCard). */
    this.treeExpanders = /* @__PURE__ */ new Map();
    /**
     * Every collapsible group label drawn in the sidebar, mapped to a function that folds it and
     * records that in settings (without saving). Used by collapseAllInTab(); weak so old DOM from a
     * previous render() is simply dropped.
     */
    this.groupCollapsers = /* @__PURE__ */ new WeakMap();
    /** Whether the click that started the current (possible) double-click landed on the tab that was already active. */
    this.tabClickWasOnActive = false;
    /**
     * The one card whose inline markdown editor is open (only one entry is edited at a time).
     * finish() saves any changes and leaves edit mode, resolving false if that was cancelled.
     */
    this.activeEdit = null;
    /** Note path whose editor should open as soon as its card is redrawn (after switching edits triggers a save + redraw). */
    this.pendingEditPath = null;
    /** The expanded card, floating over the list (see enterFloat). Only one card is expanded at a time. */
    this.floating = null;
    /** Set while re-opening a card after a redraw, so it floats straight into place without animating. */
    this.floatInstantly = false;
    // Rebuilt on every render(); let switchTab() and the nav buttons operate without closures.
    this.tabBarEl = null;
    this.tabContents = {};
    this.showTabSearchFn = null;
    this.updateShadowFn = null;
    /**
     * Back/forward history across tab switches and card expansions (including ones triggered by
     * clicking a wiki-link in an expanded card). Persists across render() calls; only the DOM it
     * points at is rebuilt.
     */
    this.navHistory = [];
    this.navIndex = -1;
    /** True while a back/forward navigation is replaying a history entry, so it isn't re-recorded. */
    this.restoringNav = false;
    this.navButtons = [];
    /** Back / Forward in the expanded card's toolbar; these step between expanded entries only (see navigateCard). */
    this.cardNavButtons = [];
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Universe Builder";
  }
  getIcon() {
    return "orbit";
  }
  async onOpen() {
    await this.render();
  }
  async onClose() {
  }
  /**
   * Redraws the whole sidebar. With keepExpanded, the cards that were expanded (per tab) are
   * re-opened afterwards, e.g. after saving an inline edit, so the saved card stays open.
   */
  async render(opts = {}) {
    var _a, _b, _c, _d;
    const { containerEl } = this;
    const scrollTop = (_b = (_a = containerEl.querySelector(".wb-scroll")) == null ? void 0 : _a.scrollTop) != null ? _b : 0;
    const reopen = [];
    if (opts.keepExpanded) {
      for (const [tab, pane] of Object.entries(this.tabContents)) {
        pane.body.querySelectorAll(".wb-card.wb-card-expanded").forEach((card) => {
          const path = card.getAttribute("data-path");
          if (path) reopen.push({ tab, path });
        });
      }
    }
    const oldSearch = containerEl.querySelector(".wb-search-input");
    const searchHadFocus = !!oldSearch && containerEl.ownerDocument.activeElement === oldSearch;
    containerEl.empty();
    containerEl.addClass("wb-sidebar");
    this.entryByPath = /* @__PURE__ */ new Map();
    this.treeExpanders = /* @__PURE__ */ new Map();
    (_c = this.activeEdit) == null ? void 0 : _c.abandon();
    this.activeEdit = null;
    void this.exitFloat(true);
    this.navButtons = [];
    this.cardNavButtons = [];
    this.bookmarkHeaderButtons = [];
    this.sectionConfigs = {};
    const fixed = containerEl.createDiv("wb-fixed");
    const scroll = containerEl.createDiv("wb-scroll");
    const header = fixed.createDiv("wb-header");
    header.createEl("h2", { text: "Universe Builder" });
    const bookmarksBtn = header.createEl("button", {
      cls: "wb-btn-secondary wb-icon-btn wb-bookmarks-btn wb-header-btn",
      attr: { type: "button", "aria-label": "Bookmarks" }
    });
    (0, import_obsidian.setIcon)(bookmarksBtn.createSpan({ cls: "wb-btn-icon" }), "bookmark");
    bookmarksBtn.createSpan({ text: "Bookmarks" });
    bookmarksBtn.onclick = () => this.toggleBookmarksView();
    this.bookmarkHeaderButtons.push(bookmarksBtn);
    const tabBar = fixed.createDiv("wb-tabs");
    const tabs = [
      { id: "characters", label: "Characters" },
      { id: "locations", label: "Locations" },
      { id: "groups", label: "Groups" },
      { id: "lore", label: "Lore" },
      { id: "timeline", label: "Timeline" }
    ];
    this.tabBarEl = tabBar;
    const contents = {};
    tabs.forEach(({ id, label }) => {
      const btn = tabBar.createEl("button", { text: label, cls: "wb-tab" });
      btn.setAttribute("data-tab", id);
      if (id === this.activeTab) btn.addClass("active");
      btn.onclick = (e) => {
        if (e.detail <= 1) this.tabClickWasOnActive = id === this.activeTab;
        if (id === this.activeTab) return;
        this.switchTab(id);
        this.recordNav(id, null);
      };
      btn.ondblclick = () => {
        if (!this.tabClickWasOnActive || id !== this.activeTab) return;
        void this.collapseAllInTab(id);
      };
      const pane = {
        head: fixed.createDiv("wb-tab-content wb-tab-head"),
        body: scroll.createDiv("wb-tab-content wb-tab-body")
      };
      if (id === this.activeTab) {
        pane.head.addClass("active");
        pane.body.addClass("active");
      }
      contents[id] = pane;
      this.searchTargets[id] = pane.body;
    });
    const bookmarksPane = {
      head: fixed.createDiv("wb-tab-content wb-tab-head"),
      body: scroll.createDiv("wb-tab-content wb-tab-body wb-bookmarks-body")
    };
    if (this.activeTab === "bookmarks") {
      bookmarksPane.head.addClass("active");
      bookmarksPane.body.addClass("active");
    }
    contents.bookmarks = bookmarksPane;
    this.searchTargets.bookmarks = bookmarksPane.body;
    this.tabContents = contents;
    const searchBox = fixed.createDiv("wb-search");
    (0, import_obsidian.setIcon)(searchBox.createSpan({ cls: "wb-search-icon" }), "search");
    const searchInput = searchBox.createEl("input", {
      cls: "wb-search-input",
      attr: { type: "text", spellcheck: "false" }
    });
    const clearBtn = searchBox.createEl("button", {
      cls: "wb-search-clear",
      attr: { type: "button", "aria-label": "Clear search" }
    });
    (0, import_obsidian.setIcon)(clearBtn, "x");
    const syncClear = () => clearBtn.classList.toggle("is-visible", searchInput.value.length > 0);
    const showTabSearch = () => {
      const hint = SEARCH_HINTS[this.activeTab];
      searchInput.value = this.searchQueries[this.activeTab];
      searchInput.setAttribute("placeholder", `Search ${hint.noun}\u2026`);
      searchInput.setAttribute("title", hint.tip);
      searchInput.setAttribute("aria-label", `Search ${hint.noun}`);
      syncClear();
    };
    const updateShadow = () => fixed.classList.toggle("is-scrolled", scroll.scrollTop > 0);
    scroll.addEventListener("scroll", updateShadow, { passive: true });
    this.showTabSearchFn = showTabSearch;
    this.updateShadowFn = updateShadow;
    const setQuery = (q) => {
      this.searchQueries[this.activeTab] = q;
      syncClear();
      this.applySearch(this.activeTab);
      scroll.scrollTop = 0;
      updateShadow();
    };
    searchInput.addEventListener("input", () => setQuery(searchInput.value));
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && searchInput.value) {
        e.preventDefault();
        e.stopPropagation();
        searchInput.value = "";
        setQuery("");
      }
    });
    clearBtn.addEventListener("click", () => {
      searchInput.value = "";
      setQuery("");
      searchInput.focus();
    });
    showTabSearch();
    const folder = this.plugin.settings.worldFolder;
    await this.renderSection(
      "characters",
      contents.characters,
      `${folder}/Characters`,
      "Characters",
      () => new CharacterModal(this.app, this.plugin, () => void this.render()).open(),
      (fm) => {
        var _a2, _b2;
        return {
          title: (_a2 = fm.name) != null ? _a2 : "Unnamed",
          // Two lines: age/home, then group/ship (a line with no values is dropped).
          meta: [
            labeledLine([["Age", fm.age], ["Home", fm.home]]),
            labeledLine([["Group", fm.group], ["Ship", fm.ship]])
          ].filter(Boolean).join("\n"),
          badge: (_b2 = fm.role) != null ? _b2 : "",
          // `pov` is set by hand in the note's properties (not in the New Character modal).
          extraBadges: hasValue(fm.pov) ? [{ text: "POV", cls: "wb-badge-pov" }] : [],
          // What the search bar matches against.
          search: [fm.name, fm.group, fm.ship, fm.home].filter(Boolean).join(" ")
        };
      },
      { thumbs: true, groupGroups: true, stackBadge: true, expandable: true }
    );
    await this.renderSection(
      "locations",
      contents.locations,
      `${folder}/Locations`,
      "Locations",
      () => new LocationModal(this.app, this.plugin, () => void this.render()).open(),
      (fm) => {
        var _a2, _b2, _c2;
        return {
          title: (_a2 = fm.name) != null ? _a2 : "Unnamed",
          // Type already shows as the badge, so the sub-line is just the parent location.
          meta: ((_b2 = fm.parent) != null ? _b2 : "").trim(),
          badge: (_c2 = fm.type) != null ? _c2 : ""
        };
      },
      {
        thumbs: true,
        expandable: true,
        hierarchical: true,
        // Ships travel, so their `parent` (where they are right now) never nests them: they
        // always start their own tree, drawn in the separate Ships section below.
        getParentName: (fm) => {
          var _a2;
          return isShip(fm) ? "" : (_a2 = fm.parent) != null ? _a2 : "";
        },
        getOwnName: (fm) => {
          var _a2;
          return (_a2 = fm.name) != null ? _a2 : "";
        },
        movableSection: { label: "Ships", isMovable: isShip }
      }
    );
    await this.renderSection(
      "groups",
      contents.groups,
      `${folder}/Groups`,
      "Groups",
      () => new GroupModal(this.app, this.plugin, () => void this.render()).open(),
      (fm) => {
        var _a2, _b2, _c2;
        return {
          title: (_a2 = fm.name) != null ? _a2 : "Unnamed",
          meta: (_b2 = fm.goals) != null ? _b2 : "",
          badge: (_c2 = fm.alignment) != null ? _c2 : ""
        };
      },
      { thumbs: true, expandable: true, typeGroups: true }
    );
    await this.renderSection(
      "lore",
      contents.lore,
      `${folder}/Lore`,
      "Lore Entries",
      () => new LoreModal(this.app, this.plugin, () => void this.render()).open(),
      (fm) => {
        var _a2, _b2, _c2;
        return {
          title: (_a2 = fm.title) != null ? _a2 : "Untitled",
          meta: (_b2 = fm.category) != null ? _b2 : "",
          badge: (_c2 = fm.category) != null ? _c2 : ""
        };
      },
      { thumbs: true, expandable: true }
    );
    await this.renderSection(
      "timeline",
      contents.timeline,
      `${folder}/Timeline`,
      "Timeline Events",
      () => new TimelineModal(this.app, this.plugin, () => void this.render()).open(),
      (fm) => {
        var _a2, _b2;
        return {
          title: (_a2 = fm.title) != null ? _a2 : "Untitled",
          meta: (_b2 = fm.date) != null ? _b2 : "",
          badge: ""
        };
      },
      { thumbs: true, expandable: true }
    );
    this.renderSectionHeader(bookmarksPane, null, true);
    this.renderBookmarks();
    if (reopen.length) {
      this.restoringNav = true;
      this.floatInstantly = true;
      try {
        for (const { tab, path } of reopen) {
          const card = (_d = contents[tab]) == null ? void 0 : _d.body.querySelector(`.wb-card[data-path="${CSS.escape(path)}"]`);
          const entry = this.entryByPath.get(path);
          if (card && entry && !card.classList.contains("wb-card-expanded")) this.toggleCardExpand(tab, card, entry);
        }
      } finally {
        this.restoringNav = false;
        this.floatInstantly = false;
      }
      this.refreshCurrentCardHighlight();
    }
    scroll.scrollTop = scrollTop;
    for (const { id } of tabs) this.applySearch(id);
    updateShadow();
    if (searchHadFocus) {
      searchInput.focus();
      const end = searchInput.value.length;
      searchInput.setSelectionRange(end, end);
    }
    if (this.navHistory.length === 0) {
      this.navHistory = [{ tab: this.activeTab, cardPath: null }];
      this.navIndex = 0;
    }
    this.updateNavButtonStates();
    this.updateBookmarkHeaderButtons();
  }
  /**
   * Hides the cards on one tab that don't match its search text (and, on Characters, any group
   * section left empty). Every word typed must appear in the card's searchable text, in any order,
   * ignoring case and accents. Works on the existing cards, so nothing is re-read or re-rendered.
   * Characters are matched on name, group, ship and home; other tabs on the name and the note's text.
   */
  applySearch(tab) {
    var _a;
    const body = this.searchTargets[tab];
    if (!body) return;
    const query = this.searchQueries[tab];
    const terms = normalizeForSearch(query).split(/\s+/).filter(Boolean);
    const searching = terms.length > 0;
    body.classList.toggle("is-searching", searching);
    const filterList = (list) => {
      let shown = 0;
      list.querySelectorAll(".wb-card").forEach((card) => {
        var _a2;
        const haystack = (_a2 = this.searchIndex.get(card)) != null ? _a2 : "";
        const match = terms.every((t) => haystack.includes(t));
        card.classList.toggle("wb-filtered-out", !match);
        if (match) shown++;
      });
      return shown;
    };
    let matches = 0;
    if (this.hierarchicalTabs.has(tab)) {
      const evalGroup = (list) => {
        let anyVisible = false;
        list.querySelectorAll(":scope > .wb-card").forEach((el) => {
          var _a2;
          const card = el;
          const haystack = (_a2 = this.searchIndex.get(card)) != null ? _a2 : "";
          const ownMatch = terms.every((t) => haystack.includes(t));
          if (ownMatch) matches++;
          const childGroup = card.nextElementSibling;
          const childList = (childGroup == null ? void 0 : childGroup.classList.contains("wb-child-group")) ? childGroup.querySelector(":scope > .wb-list") : null;
          const descendantMatch = childList ? evalGroup(childList) : false;
          const show = ownMatch || descendantMatch;
          card.classList.toggle("wb-filtered-out", searching && !show);
          const treeHeader = card.previousElementSibling;
          if (treeHeader == null ? void 0 : treeHeader.classList.contains("wb-tree-header")) {
            treeHeader.classList.toggle("wb-filtered-out", searching && !show);
          }
          if (show) anyVisible = true;
        });
        return anyVisible;
      };
      body.querySelectorAll(":scope > .wb-list").forEach((topList) => {
        const anyVisible = evalGroup(topList);
        const sectionHeader = topList.previousElementSibling;
        if (sectionHeader == null ? void 0 : sectionHeader.classList.contains("wb-tree-section-header")) {
          sectionHeader.classList.toggle("wb-filtered-out", searching && !anyVisible);
        }
      });
    } else {
      body.querySelectorAll(".wb-group-header:not(.wb-subsidiary-header)").forEach((header) => {
        const list = header.nextElementSibling;
        if (!list || !list.classList.contains("wb-list")) return;
        const shown = filterList(list);
        const hideGroup = searching && shown === 0;
        header.classList.toggle("wb-filtered-out", hideGroup);
        list.classList.toggle("wb-filtered-out", hideGroup);
        matches += shown;
      });
      body.querySelectorAll(":scope > .wb-list").forEach((list) => {
        var _a2;
        if ((_a2 = list.previousElementSibling) == null ? void 0 : _a2.classList.contains("wb-group-header")) return;
        matches += filterList(list);
      });
      const subGroups = Array.from(body.querySelectorAll(".wb-subsidiary-group")).reverse();
      for (const group of subGroups) {
        const anyShown = !!group.querySelector(":scope > .wb-list > .wb-card:not(.wb-filtered-out)");
        group.classList.toggle("wb-filtered-out", searching && !anyShown);
        const owner = group.previousElementSibling;
        if (searching && anyShown && (owner == null ? void 0 : owner.classList.contains("wb-card"))) owner.classList.remove("wb-filtered-out");
      }
    }
    const none = body.querySelector(".wb-no-results");
    if (none) {
      none.textContent = `No ${(_a = none.getAttribute("data-noun")) != null ? _a : "entries"} match \u201C${query.trim()}\u201D.`;
      none.classList.toggle("wb-filtered-out", !(searching && matches === 0));
    }
  }
  /** Returns a displayable URL for the first image embedded in a note, or null. */
  findFirstImageSrc(content, file) {
    var _a, _b;
    return (_b = (_a = this.findFirstImage(content, file)) == null ? void 0 : _a.src) != null ? _b : null;
  }
  /**
   * Finds the first image embedded in a note (the one shown as the card's portrait): its
   * displayable URL plus where its embed sits in `content`, so it can be swapped for another.
   * `size` is an Obsidian size spec on the embed ("300" or "300x200"), if it had one.
   */
  findFirstImage(content, file) {
    var _a, _b, _c, _d;
    const re = /!\[\[([^\]]+)\]\]|!\[([^\]]*)\]\((<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      const start = m.index;
      const end = m.index + m[0].length;
      let target;
      let size = "";
      if (m[1] !== void 0) {
        const parts = m[1].split("|");
        target = parts[0].split("#")[0].trim();
        size = ((_a = parts[1]) != null ? _a : "").trim();
      } else {
        size = ((_b = m[2]) != null ? _b : "").split("|").pop().trim();
        target = ((_c = m[3]) != null ? _c : "").trim();
        if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
        if (/^https?:\/\//i.test(target)) {
          const bare = target.split(/[?#]/)[0];
          if (IMG_EXT.test(bare)) {
            return { src: target, start, end, file: null, name: bare.split("/").pop() || target, size: SIZE_SPEC.test(size) ? size : "" };
          }
          continue;
        }
        try {
          target = decodeURIComponent(target);
        } catch (e) {
        }
        target = target.split("#")[0];
      }
      if (!IMG_EXT.test(target)) continue;
      const dest = (_d = this.app.metadataCache.getFirstLinkpathDest(target, file.path)) != null ? _d : this.app.vault.getAbstractFileByPath(target);
      if (dest instanceof import_obsidian.TFile) {
        return { src: this.app.vault.getResourcePath(dest), start, end, file: dest, name: dest.name, size: SIZE_SPEC.test(size) ? size : "" };
      }
    }
    return null;
  }
  async renderSection(tab, pane, folderPath, label, onCreate, getCard, opts = {}) {
    var _a, _b, _c, _d, _e, _f, _g;
    const container = pane.body;
    this.sectionConfigs[tab] = { getCard, thumbs: !!opts.thumbs, stackBadge: !!opts.stackBadge };
    this.renderSectionHeader(pane, onCreate, (_a = opts.reload) != null ? _a : true);
    const files = getMarkdownFilesIn(this.app, folderPath);
    if (files.length === 0) {
      container.createDiv("wb-list").createDiv({ cls: "wb-empty", text: `No ${label.toLowerCase()} yet.` });
      return;
    }
    const entries = [];
    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      const entry = { file, content, fm: readFrontmatter(content) };
      entries.push(entry);
      this.entryByPath.set(file.path, entry);
    }
    if (opts.hierarchical) {
      const { roots, childrenOf } = buildParentTree(
        entries,
        (_b = opts.getParentName) != null ? _b : (() => ""),
        (_c = opts.getOwnName) != null ? _c : ((fm) => {
          var _a2;
          return (_a2 = fm.name) != null ? _a2 : "";
        })
      );
      const movable = opts.movableSection;
      const fixedRoots = movable ? roots.filter((e) => !movable.isMovable(e.fm)) : roots;
      const movableRoots = movable ? roots.filter((e) => movable.isMovable(e.fm)) : [];
      this.renderHierarchicalGroup(
        tab,
        container,
        fixedRoots,
        entries,
        childrenOf,
        getCard,
        !!opts.thumbs,
        !!opts.stackBadge,
        !!opts.expandable
      );
      if (movable && movableRoots.length) {
        const header = this.createTreeHeader(container, movable.label);
        header.addClass("wb-tree-section-header");
        this.renderHierarchicalGroup(
          tab,
          container,
          movableRoots,
          entries,
          childrenOf,
          getCard,
          !!opts.thumbs,
          !!opts.stackBadge,
          !!opts.expandable
        );
        const sectionList = header.nextElementSibling;
        this.wireTreeCollapse(tab, header, [sectionList], `${tab}:section:${movable.label.toLowerCase()}`);
      }
      this.createNoResultsLine(container, label);
      return;
    }
    if (opts.typeGroups) {
      this.renderTypeGroups(tab, container, entries, getCard, opts);
      this.createNoResultsLine(container, label);
      return;
    }
    if (!opts.groupGroups) {
      const list = container.createDiv("wb-list");
      const ordered = this.orderEntries(entries, (_d = this.plugin.settings.sectionOrder[tab]) != null ? _d : []);
      for (const entry of ordered) this.renderCard(tab, list, entry, getCard, !!opts.thumbs, !!opts.stackBadge, !!opts.expandable);
      this.enableReorder(list, async (order) => {
        this.plugin.settings.sectionOrder[tab] = order;
        await this.plugin.saveSettings();
      });
      this.createNoResultsLine(container, label);
      return;
    }
    const groups = /* @__PURE__ */ new Map();
    for (const entry of entries) {
      const group = ((_e = entry.fm.group) != null ? _e : "").trim();
      const key = group.toLowerCase();
      let bucket = groups.get(key);
      if (!bucket) {
        bucket = { label: group || "No Group", items: [] };
        groups.set(key, bucket);
      }
      bucket.items.push(entry);
    }
    const groupLogos = /* @__PURE__ */ new Map();
    const groupFolder = `${this.plugin.settings.worldFolder}/Groups`;
    for (const file of getMarkdownFilesIn(this.app, groupFolder)) {
      const content = await this.app.vault.cachedRead(file);
      const src = this.findFirstImageSrc(content, file);
      if (!src) continue;
      const names = [(_f = readFrontmatter(content).name) != null ? _f : "", file.basename];
      for (const n of names) {
        const k = parseRefName(n).toLowerCase();
        if (k && !groupLogos.has(k)) groupLogos.set(k, src);
      }
    }
    const orderedGroups = [...groups.entries()].sort(
      ([a], [b]) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0) || a.localeCompare(b)
    );
    for (const [key, group] of orderedGroups) {
      const header = container.createDiv("wb-group-header");
      header.setAttribute("role", "button");
      header.setAttribute("tabindex", "0");
      (0, import_obsidian.setIcon)(header.createSpan({ cls: "wb-group-chevron" }), "chevron-down");
      const logoSrc = key ? groupLogos.get(parseRefName(key).toLowerCase()) : void 0;
      if (logoSrc) {
        const logo = header.createEl("img", {
          cls: "wb-group-logo",
          attr: { src: logoSrc, alt: "", draggable: "false" }
        });
        logo.onerror = () => logo.remove();
      }
      header.createSpan({ cls: "wb-group-title", text: group.label });
      const list = container.createDiv("wb-list");
      const applyCollapsed = (collapsed) => {
        header.classList.toggle("is-collapsed", collapsed);
        list.classList.toggle("is-collapsed", collapsed);
        header.setAttribute("aria-expanded", String(!collapsed));
      };
      applyCollapsed(this.plugin.settings.collapsedGroups.includes(key));
      this.groupCollapsers.set(header, () => {
        const settings = this.plugin.settings;
        if (!settings.collapsedGroups.includes(key)) settings.collapsedGroups = [...settings.collapsedGroups, key];
        applyCollapsed(true);
      });
      const toggleCollapsed = async () => {
        if (normalizeForSearch(this.searchQueries[tab]).trim()) return;
        const settings = this.plugin.settings;
        const collapse = !settings.collapsedGroups.includes(key);
        settings.collapsedGroups = collapse ? [...settings.collapsedGroups, key] : settings.collapsedGroups.filter((k) => k !== key);
        applyCollapsed(collapse);
        await this.plugin.saveSettings();
      };
      header.onclick = () => void toggleCollapsed();
      header.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void toggleCollapsed();
        }
      };
      const items = this.orderEntries(group.items, (_g = this.plugin.settings.characterOrder[key]) != null ? _g : []);
      for (const entry of items) this.renderCard(tab, list, entry, getCard, !!opts.thumbs, !!opts.stackBadge, !!opts.expandable);
      this.enableReorder(list, async (order) => {
        this.plugin.settings.characterOrder[key] = order;
        await this.plugin.saveSettings();
      });
    }
    this.createNoResultsLine(container, label);
  }
  /**
   * A tab's section header (fixed region): Back/Forward on the left (only when SHOW_NAV_BUTTONS is
   * on); Reload and (for the entry sections) + New on the right, the same size as the title row's
   * Bookmarks button (.wb-header-btn). The section's name isn't shown here: the highlighted tab
   * above already shows it.
   */
  renderSectionHeader(pane, onCreate, reload) {
    const hdr = pane.head.createDiv("wb-section-header");
    const titleGroup = hdr.createDiv("wb-section-title");
    if (SHOW_NAV_BUTTONS) {
      const navGroup = titleGroup.createDiv("wb-nav-buttons");
      const backBtn = navGroup.createEl("button", {
        cls: "wb-nav-btn",
        text: "<",
        attr: { type: "button", "aria-label": "Back" }
      });
      const fwdBtn = navGroup.createEl("button", {
        cls: "wb-nav-btn",
        text: ">",
        attr: { type: "button", "aria-label": "Forward" }
      });
      backBtn.onclick = () => this.navigateBack();
      fwdBtn.onclick = () => this.navigateForward();
      this.navButtons.push({ back: backBtn, fwd: fwdBtn });
    }
    const actions = hdr.createDiv("wb-section-actions");
    if (reload) {
      const reloadBtn = actions.createEl("button", { cls: "wb-btn-secondary wb-header-btn" });
      (0, import_obsidian.setIcon)(reloadBtn.createSpan({ cls: "wb-btn-icon" }), "refresh-cw");
      reloadBtn.createSpan({ text: "Reload" });
      reloadBtn.onclick = async () => {
        await this.render();
        new import_obsidian.Notice("Universe Builder reloaded.");
      };
    }
    if (onCreate) {
      const btn = actions.createEl("button", { text: "+ New", cls: "wb-btn-secondary wb-header-btn" });
      btn.onclick = onCreate;
    }
  }
  /**
   * Groups: one collapsible sub-section per `type` property (Corporation, Government, Military, then Criminal),
   * with groups that have no recognised type in an "Unassigned" section last. Headers use the
   * same chevron as the Characters group groups, without a logo. Each section is its own
   * drag-to-reorder list; its order is merged back into the tab's single saved order.
   *
   * An group whose `subsidiary-of` property names another group on this tab (matched on
   * that group's `name`, tolerant of "[[Name]]" syntax, case and accents) is not listed in its
   * own type section: it is drawn under its parent's card, inside a collapsible "Subsidiaries"
   * label, whatever its own `type` says. If the parent can't be found (unset, misspelled, not an
   * group, or part of a loop), the entry falls back to its `type` section as usual.
   */
  renderTypeGroups(tab, container, entries, getCard, opts) {
    var _a;
    const known = new Set(GROUP_TYPES.map((t) => t.key));
    const { roots, childrenOf } = buildParentTree(
      entries,
      (fm) => {
        var _a2;
        return (_a2 = fm[SUBSIDIARY_OF]) != null ? _a2 : "";
      },
      (fm) => {
        var _a2;
        return (_a2 = fm.name) != null ? _a2 : "";
      }
    );
    const groups = /* @__PURE__ */ new Map();
    for (const entry of roots) {
      const raw = ((_a = entry.fm.type) != null ? _a : "").trim().toLowerCase();
      const key = known.has(raw) ? raw : "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    const sections = [...GROUP_TYPES, { key: "", label: "Unassigned" }].filter((t) => groups.has(t.key));
    for (const { key, label } of sections) {
      const header = container.createDiv("wb-group-header");
      header.setAttribute("role", "button");
      header.setAttribute("tabindex", "0");
      (0, import_obsidian.setIcon)(header.createSpan({ cls: "wb-group-chevron" }), "chevron-down");
      header.createSpan({ cls: "wb-group-title", text: label });
      const list = container.createDiv("wb-list");
      const applyCollapsed = (collapsed) => {
        header.classList.toggle("is-collapsed", collapsed);
        list.classList.toggle("is-collapsed", collapsed);
        header.setAttribute("aria-expanded", String(!collapsed));
      };
      applyCollapsed(this.plugin.settings.collapsedGroupTypes.includes(key));
      this.groupCollapsers.set(header, () => {
        const settings = this.plugin.settings;
        if (!settings.collapsedGroupTypes.includes(key)) settings.collapsedGroupTypes = [...settings.collapsedGroupTypes, key];
        applyCollapsed(true);
      });
      const toggleCollapsed = async () => {
        if (normalizeForSearch(this.searchQueries[tab]).trim()) return;
        const settings = this.plugin.settings;
        const collapse = !settings.collapsedGroupTypes.includes(key);
        settings.collapsedGroupTypes = collapse ? [...settings.collapsedGroupTypes, key] : settings.collapsedGroupTypes.filter((k) => k !== key);
        applyCollapsed(collapse);
        await this.plugin.saveSettings();
      };
      header.onclick = () => void toggleCollapsed();
      header.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void toggleCollapsed();
        }
      };
      this.renderGroupList(tab, list, groups.get(key), entries, childrenOf, getCard, opts);
    }
  }
  /**
   * Draws one drag-to-reorder list of group cards (a type section, or one parent's
   * subsidiaries). Any card with subsidiaries gets a `.wb-child-group` right after it holding a
   * collapsible "Subsidiaries" label and their own nested list, drawn the same way (so a
   * subsidiary's own subsidiaries nest one level further in). The child group follows its card
   * when it is dragged, and subsidiaries can only be reordered among themselves.
   */
  renderGroupList(tab, list, groupEntries, allEntries, childrenOf, getCard, opts) {
    var _a;
    const items = this.orderEntries(groupEntries, (_a = this.plugin.settings.sectionOrder[tab]) != null ? _a : []);
    for (const entry of items) {
      this.renderCard(tab, list, entry, getCard, !!opts.thumbs, !!opts.stackBadge, !!opts.expandable);
      const kids = childrenOf.get(entry.file.path);
      if (kids && kids.length) this.renderSubsidiaries(tab, list, entry, kids, allEntries, childrenOf, getCard, opts);
    }
    this.enableReorder(list, async (order) => {
      var _a2;
      const settings = this.plugin.settings;
      const baseline = this.orderEntries(allEntries, (_a2 = settings.sectionOrder[tab]) != null ? _a2 : []).map((e) => e.file.path);
      settings.sectionOrder[tab] = mergeGroupOrder(baseline, items.map((e) => e.file.path), order);
      await this.plugin.saveSettings();
    });
  }
  /** The collapsible "Subsidiaries" label (and its nested list) drawn right under a parent group's card. */
  renderSubsidiaries(tab, list, parent, kids, allEntries, childrenOf, getCard, opts) {
    const path = parent.file.path;
    const group = list.createDiv("wb-child-group wb-subsidiary-group");
    const header = group.createDiv("wb-group-header wb-subsidiary-header");
    header.setAttribute("role", "button");
    header.setAttribute("tabindex", "0");
    (0, import_obsidian.setIcon)(header.createSpan({ cls: "wb-group-chevron" }), "chevron-down");
    header.createSpan({ cls: "wb-group-title", text: "Subsidiaries" });
    header.createSpan({ cls: "wb-group-count", text: String(kids.length) });
    const subList = group.createDiv("wb-list");
    const applyCollapsed = (collapsed) => {
      header.classList.toggle("is-collapsed", collapsed);
      subList.classList.toggle("is-collapsed", collapsed);
      header.setAttribute("aria-expanded", String(!collapsed));
    };
    applyCollapsed(this.plugin.settings.collapsedSubsidiaries.includes(path));
    this.groupCollapsers.set(header, () => {
      const settings = this.plugin.settings;
      if (!settings.collapsedSubsidiaries.includes(path)) settings.collapsedSubsidiaries = [...settings.collapsedSubsidiaries, path];
      applyCollapsed(true);
    });
    const toggleCollapsed = async () => {
      if (normalizeForSearch(this.searchQueries[tab]).trim()) return;
      const settings = this.plugin.settings;
      const collapse = !settings.collapsedSubsidiaries.includes(path);
      settings.collapsedSubsidiaries = collapse ? [...settings.collapsedSubsidiaries, path] : settings.collapsedSubsidiaries.filter((p) => p !== path);
      applyCollapsed(collapse);
      await this.plugin.saveSettings();
    };
    header.onclick = () => void toggleCollapsed();
    header.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        void toggleCollapsed();
      }
    };
    this.renderGroupList(tab, subList, kids, allEntries, childrenOf, getCard, opts);
  }
  /**
   * Applies a saved manual order (a list of note paths, earliest first) to a set of entries.
   * Anything not yet present in `saved` keeps its original relative position after the ordered ones.
   */
  orderEntries(entries, saved) {
    const rank = (path) => {
      const i = saved.indexOf(path);
      return i === -1 ? saved.length : i;
    };
    return entries.map((entry, index) => ({ entry, index })).sort((a, b) => rank(a.entry.file.path) - rank(b.entry.file.path) || a.index - b.index).map(({ entry }) => entry);
  }
  /**
   * Draws one sibling group of a hierarchical (parent/child) tab - the roots, or one parent's
   * children - as its own `.wb-list`, then recurses into each entry's own children (if any)
   * as a further-indented sibling group nested right after that entry's card. Each group gets
   * its own enableReorder() call, so a card can only be dragged among its own siblings, and
   * indentation is pure left-side margin (`.wb-child-group` in styles.css) that shrinks the
   * nested group in from the left while its right edge stays flush with everything above it.
   */
  renderHierarchicalGroup(tab, host, groupEntries, allEntries, childrenOf, getCard, thumbs, stackBadge, expandable) {
    var _a;
    const list = host.createDiv("wb-list");
    const ordered = this.orderEntries(groupEntries, (_a = this.plugin.settings.sectionOrder[tab]) != null ? _a : []);
    for (const entry of ordered) {
      const kids = childrenOf.get(entry.file.path);
      const header = this.createTreeHeader(list, getCard(entry.fm).title);
      const card = this.renderCard(tab, list, entry, getCard, thumbs, stackBadge, expandable);
      const parts = [card];
      if (kids && kids.length) {
        const childHost = list.createDiv("wb-child-group");
        this.renderHierarchicalGroup(tab, childHost, kids, allEntries, childrenOf, getCard, thumbs, stackBadge, expandable);
        parts.push(childHost);
      }
      this.wireTreeCollapse(tab, header, parts, entry.file.path);
    }
    this.enableReorder(list, async (order) => {
      var _a2;
      const settings = this.plugin.settings;
      const baseline = this.orderEntries(allEntries, (_a2 = settings.sectionOrder[tab]) != null ? _a2 : []).map((e) => e.file.path);
      const groupPaths = ordered.map((e) => e.file.path);
      settings.sectionOrder[tab] = mergeGroupOrder(baseline, groupPaths, order);
      await this.plugin.saveSettings();
    });
  }
  /** A collapsible label (chevron + name) drawn above every hierarchical entry's card. */
  createTreeHeader(list, title) {
    const header = list.createDiv("wb-group-header wb-tree-header");
    header.setAttribute("role", "button");
    header.setAttribute("tabindex", "0");
    (0, import_obsidian.setIcon)(header.createSpan({ cls: "wb-group-chevron" }), "chevron-down");
    header.createSpan({ cls: "wb-group-title", text: title });
    return header;
  }
  /**
   * Makes a hierarchical parent's label collapse (or expand) the parent's own card together with
   * its whole nested subtree - e.g. collapsing SOL hides everything in SOL, collapsing Earth hides
   * Earth, Las Luna and Colonia. Nested labels keep their own saved state, so re-opening SOL shows
   * Earth still collapsed if it was. The state is saved per note path in plugin data.
   */
  wireTreeCollapse(tab, header, parts, path) {
    for (const p of parts) p.setAttribute("data-tree-owner", path);
    const apply = (collapsed) => {
      header.classList.toggle("is-collapsed", collapsed);
      header.setAttribute("aria-expanded", String(!collapsed));
      for (const p of parts) p.classList.toggle("wb-tree-hidden", collapsed);
    };
    apply(this.plugin.settings.collapsedParents.includes(path));
    const setCollapsed = async (collapse) => {
      apply(collapse);
      const settings = this.plugin.settings;
      if (settings.collapsedParents.includes(path) === collapse) return;
      settings.collapsedParents = collapse ? [...settings.collapsedParents, path] : settings.collapsedParents.filter((p) => p !== path);
      await this.plugin.saveSettings();
    };
    this.treeExpanders.set(path, () => setCollapsed(false));
    this.groupCollapsers.set(header, () => {
      const settings = this.plugin.settings;
      if (!settings.collapsedParents.includes(path)) settings.collapsedParents = [...settings.collapsedParents, path];
      apply(true);
    });
    const toggle = () => {
      if (normalizeForSearch(this.searchQueries[tab]).trim()) return;
      void setCollapsed(!header.classList.contains("is-collapsed"));
    };
    header.onclick = toggle;
    header.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    };
  }
  /** The "No ... match" line; hidden until applySearch() finds nothing. */
  createNoResultsLine(container, label) {
    container.createDiv({
      cls: "wb-empty wb-no-results wb-filtered-out",
      attr: { "data-noun": label.toLowerCase() }
    });
  }
  renderCard(tab, parent, entry, getCard, thumbs, stackBadge, expandable) {
    const { file, content, fm } = entry;
    const { title, meta, badge, search, extraBadges } = getCard(fm);
    const card = parent.createDiv("wb-card");
    if (stackBadge) card.addClass("wb-card-stacked");
    card.setAttribute("data-path", file.path);
    this.searchIndex.set(card, normalizeForSearch(search != null ? search : `${title} ${documentSearchText(content, fm)}`));
    let body = card;
    if (thumbs) {
      card.addClass("wb-card-with-thumb");
      const row = card.createDiv("wb-card-row");
      const thumb = row.createDiv("wb-thumb");
      const src = this.findFirstImageSrc(content, file);
      if (src) {
        const img = thumb.createEl("img", { attr: { src, alt: "", draggable: "false" } });
        thumb.addClass("wb-thumb-has-img");
        const zoomBadge = thumb.createSpan({ cls: "wb-thumb-zoom", attr: { "aria-hidden": "true" } });
        (0, import_obsidian.setIcon)(zoomBadge, "zoom-in");
        img.onerror = () => {
          img.remove();
          zoomBadge.remove();
          thumb.removeClass("wb-thumb-has-img");
        };
        thumb.addEventListener("click", (e) => {
          if (!card.classList.contains("wb-card-expanded") || !thumb.contains(img)) return;
          e.preventDefault();
          e.stopPropagation();
          openImageZoom(src, title);
        });
      }
      body = row.createDiv("wb-card-body");
      this.enableImageDrop(card, entry, title);
    }
    const titleEl = body.createDiv("wb-card-title");
    titleEl.createSpan({ text: title });
    if (expandable) titleEl.addClass("wb-card-title-row");
    const extras = extraBadges != null ? extraBadges : [];
    if (badge || extras.length) {
      const badgeHost = stackBadge ? body.createDiv("wb-card-badge-row") : titleEl;
      if (badge) {
        const b = badgeHost.createSpan({ cls: `wb-badge wb-badge-${badge.toLowerCase()}` });
        b.setText(badge);
      }
      for (const extra of extras) badgeHost.createSpan({ cls: `wb-badge ${extra.cls}`, text: extra.text });
    }
    if (expandable) (0, import_obsidian.setIcon)(titleEl.createSpan({ cls: "wb-card-chevron" }), "chevron-right");
    if (meta) for (const line of meta.split("\n")) body.createDiv({ cls: "wb-card-meta", text: line });
    if (expandable) {
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-expanded", "false");
      card.onclick = () => this.toggleCardExpand(tab, card, entry);
      card.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.toggleCardExpand(tab, card, entry);
        }
      };
    } else {
      card.onclick = () => this.app.workspace.getLeaf().openFile(file);
    }
    return card;
  }
  /**
   * Expands a card to show the note's text (all but the portrait image) instead of opening it in the
   * editor, so writing in the main pane isn't interrupted. The expanded card floats over the list
   * (see enterFloat), and only one card is expanded at a time: expanding another closes the open
   * one first. Modify MD opens the note the normal way; Edit edits its markdown inline, still
   * floating. Clicking the card's title row again (its X) collapses it back into the list.
   * `force` skips the "Discard changes?" question (already answered).
   */
  toggleCardExpand(tab, card, entry, force = false) {
    var _a, _b, _c, _d, _e, _f;
    const wasExpanded = card.classList.contains("wb-card-expanded");
    if (wasExpanded && !force && ((_a = this.activeEdit) == null ? void 0 : _a.card) === card && this.activeEdit.isDirty()) {
      void confirmModal(this.app, "Discard changes?", `Your edits to "${entry.file.basename}" haven't been saved.`, "Discard").then((ok) => {
        if (ok) this.toggleCardExpand(tab, card, entry, true);
      });
      return;
    }
    if (wasExpanded) {
      this.collapseCard(card, false);
      this.recordNav(tab, null);
      return;
    }
    const other = (_b = this.floating) == null ? void 0 : _b.card;
    if (other && other !== card && other.isConnected && other.classList.contains("wb-card-expanded")) {
      if (!force && ((_c = this.activeEdit) == null ? void 0 : _c.card) === other && this.activeEdit.isDirty()) {
        const name = (_f = (_e = this.entryByPath.get((_d = other.getAttribute("data-path")) != null ? _d : "")) == null ? void 0 : _e.file.basename) != null ? _f : "this entry";
        void confirmModal(this.app, "Discard changes?", `Your edits to "${name}" haven't been saved.`, "Discard").then((ok) => {
          if (ok) this.toggleCardExpand(tab, card, entry, true);
        });
        return;
      }
    }
    let switching = false;
    if (other && other !== card && other.isConnected && other.classList.contains("wb-card-expanded")) {
      this.collapseCard(other, true);
      switching = true;
    }
    this.enterFloat(card, switching);
    card.addClass("wb-card-expanded");
    card.setAttribute("aria-expanded", "true");
    const expand = card.createDiv("wb-card-expand");
    expand.setAttribute("draggable", "false");
    expand.onclick = (e) => e.stopPropagation();
    expand.onkeydown = (e) => e.stopPropagation();
    const body = expand.createDiv("wb-card-expand-body");
    body.addClass("markdown-rendered");
    body.addEventListener("contextmenu", (e) => {
      var _a2;
      const selection = body.win.getSelection();
      const text = (_a2 = selection == null ? void 0 : selection.toString()) != null ? _a2 : "";
      if (!text.trim() || !(selection == null ? void 0 : selection.anchorNode) || !body.contains(selection.anchorNode)) return;
      e.preventDefault();
      e.stopPropagation();
      const menu = new import_obsidian.Menu();
      menu.addItem(
        (item) => item.setTitle("Copy").setIcon("copy").onClick(() => {
          void navigator.clipboard.writeText(text).catch(() => new import_obsidian.Notice("Couldn't copy the selection."));
        })
      );
      menu.showAtMouseEvent(e);
    });
    const portraitMatch = this.findFirstImage(entry.content, entry.file);
    const withoutPortrait = portraitMatch ? entry.content.slice(0, portraitMatch.start) + entry.content.slice(portraitMatch.end) : entry.content;
    const bodyText = stripLeadingHeading(stripFrontmatterBlock(withoutPortrait));
    void import_obsidian.MarkdownRenderer.render(this.app, bodyText, body, entry.file.path, this);
    body.addEventListener("click", (e) => {
      var _a2;
      const target = e.target;
      if (target.instanceOf(HTMLImageElement) && target.src) {
        e.preventDefault();
        e.stopPropagation();
        openImageZoom(target.src, target.alt || entry.file.basename);
        return;
      }
      const link = target.closest("a.internal-link");
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      const href = (_a2 = link.getAttribute("data-href")) != null ? _a2 : link.getAttribute("href");
      if (href) this.followWikiLink(href, entry.file.path);
    });
    const toolbar = createDiv("wb-card-expand-toolbar");
    body.insertAdjacentElement("beforebegin", toolbar);
    const leftGroup = toolbar.createDiv("wb-card-expand-left");
    const navBtn = (label, icon, dir) => {
      const btn = leftGroup.createEl("button", {
        cls: "wb-btn-secondary wb-icon-btn wb-card-nav-btn",
        attr: { type: "button", "aria-label": label }
      });
      (0, import_obsidian.setIcon)(btn, icon);
      btn.onclick = () => this.navigateCard(dir);
      return btn;
    };
    const cardBack = navBtn("Back", "chevron-left", -1);
    const cardFwd = navBtn("Forward", "chevron-right", 1);
    this.cardNavButtons.push({ back: cardBack, fwd: cardFwd });
    this.updateNavButtonStates();
    leftGroup.createSpan({ cls: "wb-toolbar-sep", text: "|", attr: { "aria-hidden": "true" } });
    const bookmarkBtn = leftGroup.createEl("button", {
      cls: "wb-btn-secondary wb-icon-btn wb-bookmark-toggle",
      attr: { type: "button", "data-bookmark-path": entry.file.path }
    });
    (0, import_obsidian.setIcon)(bookmarkBtn.createSpan({ cls: "wb-btn-icon" }), "bookmark");
    bookmarkBtn.createSpan({ text: "Bookmark" });
    this.syncBookmarkToggle(bookmarkBtn, this.plugin.settings.bookmarks.includes(entry.file.path));
    bookmarkBtn.onclick = () => void this.toggleBookmark(entry.file.path);
    const actions = toolbar.createDiv("wb-card-expand-actions");
    const showViewActions = () => {
      actions.empty();
      const modifyBtn = actions.createEl("button", { cls: "wb-btn-secondary", attr: { type: "button" } });
      (0, import_obsidian.setIcon)(modifyBtn.createSpan({ cls: "wb-btn-icon" }), "file-text");
      modifyBtn.createSpan({ text: "Modify MD" });
      modifyBtn.onclick = () => this.app.workspace.getLeaf().openFile(entry.file);
      const editBtn = actions.createEl("button", { cls: "wb-btn-secondary", attr: { type: "button" } });
      (0, import_obsidian.setIcon)(editBtn.createSpan({ cls: "wb-btn-icon" }), "pencil");
      editBtn.createSpan({ text: "Edit" });
      editBtn.onclick = () => void runExclusive(startEditing);
    };
    const showEditActions = () => {
      actions.empty();
      const cancelBtn = actions.createEl("button", { cls: "wb-btn-secondary", attr: { type: "button" } });
      (0, import_obsidian.setIcon)(cancelBtn.createSpan({ cls: "wb-btn-icon" }), "x");
      cancelBtn.createSpan({ text: "Cancel" });
      cancelBtn.onclick = () => void runExclusive(discard);
      const saveBtn = actions.createEl("button", { cls: "wb-btn-secondary", attr: { type: "button" } });
      (0, import_obsidian.setIcon)(saveBtn.createSpan({ cls: "wb-btn-icon" }), "check");
      saveBtn.createSpan({ text: "Save" });
      saveBtn.onclick = () => void runExclusive(finishEditing);
    };
    let editor = null;
    let portrait = null;
    const removePortraitPicker = () => {
      portrait == null ? void 0 : portrait.picker.destroy();
      portrait == null ? void 0 : portrait.holder.remove();
      portrait = null;
    };
    let original = "";
    let busy = false;
    const runExclusive = async (fn) => {
      if (busy) return;
      busy = true;
      try {
        await fn();
      } finally {
        busy = false;
      }
    };
    const isDirty = () => !!editor && (editor.isDirty() || !!(portrait == null ? void 0 : portrait.picker.hasImage));
    const stopEditing = () => {
      var _a2;
      if (((_a2 = this.activeEdit) == null ? void 0 : _a2.card) === card) this.activeEdit = null;
      editor == null ? void 0 : editor.destroy();
      editor = null;
      removePortraitPicker();
      body.show();
      expand.removeClass("is-editing");
      showViewActions();
    };
    const startEditing = async () => {
      var _a2, _b2, _c2;
      const other2 = this.activeEdit;
      if (other2 && other2.card !== card) {
        this.pendingEditPath = entry.file.path;
        const ok = await other2.finish();
        if (!ok || !card.isConnected) {
          if (!ok) this.pendingEditPath = null;
          return;
        }
        this.pendingEditPath = null;
      }
      try {
        original = await this.app.vault.read(entry.file);
      } catch (e) {
        new import_obsidian.Notice(`Couldn't read "${entry.file.basename}".`);
        return;
      }
      if (!card.isConnected || !expand.isConnected || editor) return;
      expand.addClass("is-editing");
      showEditActions();
      body.hide();
      if (!this.findFirstImage(original, entry.file)) {
        const holder = createDiv("wb-card-editor-portrait");
        body.insertAdjacentElement("beforebegin", holder);
        const picker = new PortraitPicker(this.app, this.plugin, holder, (_b2 = (_a2 = entry.file.parent) == null ? void 0 : _a2.path) != null ? _b2 : this.plugin.settings.worldFolder);
        portrait = { picker, holder };
      }
      const keys = {
        save: () => void runExclusive(finishEditing),
        cancel: () => void runExclusive(discard)
      };
      editor = (_c2 = this.plugin.settings.inlineEditor === "live" ? createLivePreviewEditor(this.app, this, body, entry.file, original, keys, this.findFirstImage(original, entry.file)) : null) != null ? _c2 : createRawEditor(body, entry.file, original, keys);
      this.activeEdit = {
        card,
        isDirty,
        finish: async () => {
          await finishEditing();
          return !editor || !card.isConnected;
        },
        abandon: () => {
          editor == null ? void 0 : editor.destroy();
          editor = null;
          removePortraitPicker();
        }
      };
      editor.focus();
    };
    const discard = async () => {
      if (isDirty() && !await confirmModal(this.app, "Discard changes?", `Your edits to "${entry.file.basename}" haven't been saved.`, "Discard")) {
        editor == null ? void 0 : editor.focus();
        return;
      }
      stopEditing();
    };
    const finishEditing = async () => {
      var _a2;
      if (!editor) return;
      if (!isDirty()) {
        stopEditing();
        return;
      }
      try {
        if (editor.isDirty()) {
          const current = await this.app.vault.read(entry.file);
          if (current !== original && !await confirmModal(
            this.app,
            "Note changed elsewhere",
            `"${entry.file.basename}" was modified outside the sidebar after you started editing. Overwrite it with your version?`,
            "Overwrite"
          )) {
            editor == null ? void 0 : editor.focus();
            return;
          }
          if (!editor) return;
          await this.app.vault.modify(entry.file, editor.getText());
        }
        await (portrait == null ? void 0 : portrait.picker.attachTo(entry.file, `Saved "${entry.file.basename}", but its portrait couldn't be imported.`));
        removePortraitPicker();
        if (((_a2 = this.activeEdit) == null ? void 0 : _a2.card) === card) this.activeEdit = null;
        editor == null ? void 0 : editor.destroy();
        editor = null;
        await this.render({ keepExpanded: true });
        new import_obsidian.Notice(`Saved "${entry.file.basename}".`);
      } catch (err) {
        console.error("Universe Builder: save failed", err);
        new import_obsidian.Notice(`Couldn't save "${entry.file.basename}".`);
      }
    };
    showViewActions();
    if (this.pendingEditPath === entry.file.path) {
      this.pendingEditPath = null;
      void runExclusive(startEditing);
    }
    this.recordNav(tab, entry.file.path);
  }
  /**
   * Collapses an expanded card back into its list: closes its inline editor (without saving), removes
   * the expanded area, and shrinks it from floating back into its place (at once if `instant`).
   */
  collapseCard(card, instant) {
    var _a, _b, _c;
    if (((_a = this.activeEdit) == null ? void 0 : _a.card) === card) {
      this.activeEdit.abandon();
      this.activeEdit = null;
    }
    (_b = card.querySelector(":scope > .wb-card-expand")) == null ? void 0 : _b.remove();
    card.removeClass("wb-card-expanded");
    card.setAttribute("aria-expanded", "false");
    if (((_c = this.floating) == null ? void 0 : _c.card) === card) void this.exitFloat(instant);
  }
  // ─── Floating card (expanded entry over the list) ──────────────────────────────
  /**
   * Floats an expanding card over the list: it covers the list area plus the section header and
   * search bar, from just under the section tabs to the bottom of the sidebar, inset by FLOAT_GAP
   * (FLOAT_GAP_BOTTOM at the bottom), with everything behind it dimmed. It stays floating in
   * read mode and while being edited inline. The card is lifted out of the list (position:
   * absolute on the view's root) and a placeholder of its height keeps its spot, so nothing below
   * it moves and exitFloat() can shrink it straight back. Call it before adding the card's
   * expanded contents: the animation starts from the card's current (collapsed) size. `instant`
   * skips the animation (used when switching straight from another expanded entry).
   */
  enterFloat(card, instant = false) {
    void this.exitFloat(true);
    const root = this.containerEl;
    const pane = card.closest(".wb-tab-body");
    if (!pane || !card.isConnected) return;
    const start = this.rectInRoot(card);
    const placeholder = createDiv("wb-edit-placeholder");
    placeholder.style.height = `${start.height}px`;
    card.insertAdjacentElement("beforebegin", placeholder);
    const backdrop = root.createDiv("wb-edit-backdrop");
    const observer = new ResizeObserver(() => this.updateFloatBounds());
    observer.observe(root);
    const fixed = root.querySelector(".wb-fixed");
    if (fixed) observer.observe(fixed);
    const tabBar = root.querySelector(".wb-tabs");
    if (tabBar) observer.observe(tabBar);
    this.floating = { card, placeholder, pane, backdrop, observer, draggable: card.getAttribute("draggable") };
    this.updateFloatBounds();
    card.setAttribute("draggable", "false");
    this.setCardChevron(card, "x");
    root.addClass("wb-has-edit-focus");
    pane.addClass("wb-edit-focus-pane");
    card.addClass("wb-card-focus");
    const paneShown = pane.classList.contains("active");
    root.toggleClass("wb-edit-focus-hidden", !paneShown);
    if (instant || this.floatInstantly || !paneShown || this.reducedMotion()) {
      backdrop.addClass("is-visible");
      return;
    }
    this.setFocusGeometry(card, start);
    card.addClass("wb-card-focus-animating");
    void card.offsetWidth;
    backdrop.addClass("is-visible");
    this.setFocusGeometry(card, this.focusTarget());
    window.setTimeout(() => {
      var _a;
      if (((_a = this.floating) == null ? void 0 : _a.card) !== card) return;
      card.removeClass("wb-card-focus-animating");
      this.setFocusGeometry(card, null);
    }, FLOAT_MS);
  }
  /**
   * Shrinks the floating card back into its place in the list and restores the list. Resolves
   * once the animation has finished. `instant` skips the animation (the card is being collapsed
   * or redrawn); so does a card that's no longer on screen.
   */
  async exitFloat(instant = false) {
    const focus = this.floating;
    if (!focus) return;
    this.floating = null;
    focus.observer.disconnect();
    const { card, placeholder, pane, backdrop } = focus;
    const finish = () => {
      card.removeClass("wb-card-focus", "wb-card-focus-animating");
      this.setFocusGeometry(card, null);
      this.setCardChevron(card, "chevron-right");
      if (focus.draggable === null) card.removeAttribute("draggable");
      else card.setAttribute("draggable", focus.draggable);
      placeholder.remove();
      backdrop.remove();
      pane.removeClass("wb-edit-focus-pane");
      this.containerEl.removeClass("wb-has-edit-focus", "wb-edit-focus-hidden");
    };
    const visible = card.isConnected && placeholder.isConnected && card.offsetParent !== null;
    if (instant || !visible || this.reducedMotion()) {
      finish();
      return;
    }
    const target = this.rectInRoot(placeholder);
    this.setFocusGeometry(card, this.rectInRoot(card));
    card.addClass("wb-card-focus-animating");
    void card.offsetWidth;
    backdrop.removeClass("is-visible");
    this.setFocusGeometry(card, target);
    await new Promise((resolve) => window.setTimeout(resolve, FLOAT_MS));
    finish();
  }
  /** Swaps the icon in a card's title-row chevron (the collapsed arrow, or an X while the card floats). */
  setCardChevron(card, icon) {
    const chevron = card.querySelector(":scope > .wb-card-row .wb-card-chevron, :scope > .wb-card-title .wb-card-chevron");
    if (!chevron) return;
    chevron.empty();
    (0, import_obsidian.setIcon)(chevron, icon);
  }
  /** Recomputes the edges of the area the floating card fills (CSS variables on the root). */
  updateFloatBounds() {
    const root = this.containerEl;
    const scroll = root.querySelector(".wb-scroll");
    if (!scroll) return;
    const r = root.getBoundingClientRect();
    const sc = scroll.getBoundingClientRect();
    const cs = getComputedStyle(scroll);
    const tabs = root.querySelector(".wb-tabs");
    const top = (tabs ? tabs.getBoundingClientRect().bottom : sc.top) - r.top;
    root.style.setProperty("--wb-focus-area-top", `${top}px`);
    root.style.setProperty("--wb-focus-top", `${top + FLOAT_GAP}px`);
    root.style.setProperty("--wb-focus-bottom", `${r.bottom - sc.bottom + FLOAT_GAP_BOTTOM}px`);
    root.style.setProperty("--wb-focus-left", `${sc.left - r.left + (parseFloat(cs.paddingLeft) || 0)}px`);
    root.style.setProperty("--wb-focus-right", `${r.right - sc.right + (parseFloat(cs.paddingRight) || 0)}px`);
  }
  /** Where the floating card ends up, in the root's coordinates. */
  focusTarget() {
    const root = this.containerEl;
    const r = root.getBoundingClientRect();
    const px = (name) => parseFloat(root.style.getPropertyValue(name)) || 0;
    const top = px("--wb-focus-top");
    const left = px("--wb-focus-left");
    return { top, left, width: r.width - left - px("--wb-focus-right"), height: r.height - top - px("--wb-focus-bottom") };
  }
  /** An element's box relative to the view's root (the floating card's containing block). */
  rectInRoot(el) {
    const r = this.containerEl.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    return { top: b.top - r.top, left: b.left - r.left, width: b.width, height: b.height };
  }
  /** Pins the card to an explicit box while animating; null goes back to the CSS focus bounds. */
  setFocusGeometry(card, box) {
    if (!box) {
      for (const prop of ["top", "left", "width", "height", "right", "bottom"]) card.style.removeProperty(prop);
      return;
    }
    card.setCssStyles({
      top: `${box.top}px`,
      left: `${box.left}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      right: "auto",
      bottom: "auto"
    });
  }
  reducedMotion() {
    var _a, _b;
    return (_b = (_a = window.matchMedia) == null ? void 0 : _a.call(window, "(prefers-reduced-motion: reduce)").matches) != null ? _b : false;
  }
  /**
   * "Collapse all" for one section, triggered by double-clicking its (already active) tab button:
   * closes every expanded card preview and folds every collapsible group label in the section
   * (group groups on Characters, type groups and Subsidiaries on Groups, every tree label
   * and the Ships section on Locations). The folded state is saved like a manual fold. While a
   * search is active the matching entries still show (as with a manual fold); the saved state
   * takes over once the search is cleared.
   */
  async collapseAllInTab(tab) {
    var _a;
    const pane = this.tabContents[tab];
    if (!pane) return;
    let closedCard = false;
    pane.body.querySelectorAll(".wb-card.wb-card-expanded").forEach((card) => {
      var _a2;
      if (((_a2 = this.activeEdit) == null ? void 0 : _a2.card) === card && this.activeEdit.isDirty()) return;
      this.collapseCard(card, false);
      closedCard = true;
    });
    if (closedCard) this.recordNav(tab, null);
    let folded = false;
    pane.body.querySelectorAll(".wb-group-header").forEach((header) => {
      const collapse = this.groupCollapsers.get(header);
      if (!collapse) return;
      collapse();
      folded = true;
    });
    this.refreshCurrentCardHighlight();
    (_a = this.updateShadowFn) == null ? void 0 : _a.call(this);
    if (folded) await this.plugin.saveSettings();
  }
  /** The section folder a tab's notes live in, e.g. "UniverseBuilder/Characters". */
  tabFolder(tab) {
    return `${this.plugin.settings.worldFolder}/${SECTION_LABELS[tab]}`;
  }
  /** Which tab (if any) a given file's own card lives on. */
  findEntryTab(file) {
    for (const tab of SECTION_TABS) {
      if (file.path.startsWith(this.tabFolder(tab) + "/")) return tab;
    }
    return null;
  }
  /**
   * Switches the active tab's DOM (fixed header half + scrolling body half) without touching
   * navigation history — callers that count as a "navigation" record it themselves via recordNav().
   */
  switchTab(id) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    this.activeTab = id;
    if (id !== "bookmarks") this.lastSectionTab = id;
    (_a = this.tabBarEl) == null ? void 0 : _a.querySelectorAll(".wb-tab").forEach((b) => b.removeClass("active"));
    (_c = (_b = this.tabBarEl) == null ? void 0 : _b.querySelector(`.wb-tab[data-tab="${id}"]`)) == null ? void 0 : _c.addClass("active");
    Object.values(this.tabContents).forEach((c) => {
      c == null ? void 0 : c.head.removeClass("active");
      c == null ? void 0 : c.body.removeClass("active");
    });
    (_d = this.tabContents[id]) == null ? void 0 : _d.head.addClass("active");
    (_e = this.tabContents[id]) == null ? void 0 : _e.body.addClass("active");
    this.containerEl.toggleClass("wb-edit-focus-hidden", !!this.floating && this.floating.pane !== ((_f = this.tabContents[id]) == null ? void 0 : _f.body));
    (_g = this.showTabSearchFn) == null ? void 0 : _g.call(this);
    (_h = this.updateShadowFn) == null ? void 0 : _h.call(this);
    this.updateBookmarkHeaderButtons();
  }
  // ─── Bookmarks ───────────────────────────────────────────────────────────
  /** The title row's Bookmarks button: opens the Bookmarks view, or goes back to the last section if it's already open. */
  toggleBookmarksView() {
    const target = this.activeTab === "bookmarks" ? this.lastSectionTab : "bookmarks";
    this.switchTab(target);
    this.recordNav(target, null);
  }
  updateBookmarkHeaderButtons() {
    const open = this.activeTab === "bookmarks";
    for (const btn of this.bookmarkHeaderButtons) {
      btn.classList.toggle("is-active", open);
      btn.setAttribute("aria-pressed", String(open));
      btn.setAttribute("aria-label", open ? "Close bookmarks" : "Bookmarks");
    }
  }
  syncBookmarkToggle(btn, on) {
    btn.classList.toggle("is-bookmarked", on);
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? "Remove bookmark" : "Add bookmark");
  }
  /** Adds or removes one note from the bookmarks, updating every expanded copy of its card. */
  async toggleBookmark(path) {
    const settings = this.plugin.settings;
    const on = !settings.bookmarks.includes(path);
    settings.bookmarks = on ? [...settings.bookmarks, path] : settings.bookmarks.filter((p) => p !== path);
    this.containerEl.querySelectorAll(".wb-bookmark-toggle").forEach((btn) => {
      if (btn.getAttribute("data-bookmark-path") === path) this.syncBookmarkToggle(btn, on);
    });
    this.renderBookmarks();
    await this.plugin.saveSettings();
  }
  /**
   * Draws the Bookmarks view's list: bookmarked entries grouped under collapsible section headers
   * (Characters, Locations, ...), each card drawn exactly as on its own tab. Each group can be
   * dragged into its own order, saved back into the single bookmarks list.
   */
  renderBookmarks() {
    var _a;
    const pane = this.tabContents.bookmarks;
    if (!pane) return;
    const container = pane.body;
    const tab = "bookmarks";
    const wasExpanded = new Set(
      Array.from(container.querySelectorAll(".wb-card.wb-card-expanded")).map(
        (c) => {
          var _a2;
          return (_a2 = c.getAttribute("data-path")) != null ? _a2 : "";
        }
      )
    );
    const scrollEl = this.activeTab === tab ? container.closest(".wb-scroll") : null;
    const scrollTop = (_a = scrollEl == null ? void 0 : scrollEl.scrollTop) != null ? _a : 0;
    container.empty();
    if (this.floating && !this.floating.card.isConnected) void this.exitFloat(true);
    const entries = this.plugin.settings.bookmarks.map((path) => this.entryByPath.get(path)).filter((e) => !!e);
    if (entries.length === 0) {
      container.createDiv("wb-list").createDiv({
        cls: "wb-empty",
        text: "No bookmarks yet. Expand an entry and click its bookmark icon to add it here."
      });
      this.applySearch(tab);
      return;
    }
    for (const section of SECTION_TABS) {
      const cfg = this.sectionConfigs[section];
      const items = entries.filter((e) => this.findEntryTab(e.file) === section);
      if (!cfg || items.length === 0) continue;
      const header = container.createDiv("wb-group-header");
      header.setAttribute("role", "button");
      header.setAttribute("tabindex", "0");
      (0, import_obsidian.setIcon)(header.createSpan({ cls: "wb-group-chevron" }), "chevron-down");
      header.createSpan({ cls: "wb-group-title", text: SECTION_LABELS[section] });
      const list = container.createDiv("wb-list");
      const applyCollapsed = (collapsed) => {
        header.classList.toggle("is-collapsed", collapsed);
        list.classList.toggle("is-collapsed", collapsed);
        header.setAttribute("aria-expanded", String(!collapsed));
      };
      applyCollapsed(this.plugin.settings.collapsedBookmarkGroups.includes(section));
      const toggleCollapsed = async () => {
        if (normalizeForSearch(this.searchQueries[tab]).trim()) return;
        const settings = this.plugin.settings;
        const collapse = !settings.collapsedBookmarkGroups.includes(section);
        settings.collapsedBookmarkGroups = collapse ? [...settings.collapsedBookmarkGroups, section] : settings.collapsedBookmarkGroups.filter((k) => k !== section);
        applyCollapsed(collapse);
        await this.plugin.saveSettings();
      };
      header.onclick = () => void toggleCollapsed();
      header.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void toggleCollapsed();
        }
      };
      for (const entry of items) this.renderCard(tab, list, entry, cfg.getCard, cfg.thumbs, cfg.stackBadge, true);
      this.enableReorder(list, async (order) => {
        const settings = this.plugin.settings;
        const kept = order.filter((p) => settings.bookmarks.includes(p));
        settings.bookmarks = mergeGroupOrder(settings.bookmarks, items.map((e) => e.file.path), kept);
        await this.plugin.saveSettings();
      });
    }
    this.createNoResultsLine(container, "Bookmarks");
    this.applySearch(tab);
    if (wasExpanded.size) {
      this.restoringNav = true;
      this.floatInstantly = true;
      try {
        container.querySelectorAll(".wb-card").forEach((card) => {
          var _a2;
          const path = (_a2 = card.getAttribute("data-path")) != null ? _a2 : "";
          const entry = this.entryByPath.get(path);
          if (entry && wasExpanded.has(path)) this.toggleCardExpand(tab, card, entry);
        });
      } finally {
        this.restoringNav = false;
        this.floatInstantly = false;
      }
    }
    if (scrollEl) scrollEl.scrollTop = scrollTop;
    this.refreshCurrentCardHighlight();
  }
  /**
   * Records where the sidebar is now pointed (which tab, and which card - if any - is the one the
   * user just navigated to) as a Back/Forward history entry. Ignored while a Back/Forward click is
   * itself replaying a past entry, and skipped if it's identical to the current entry.
   */
  recordNav(tab, cardPath) {
    if (this.restoringNav) return;
    const top = this.navHistory[this.navIndex];
    if (top && top.tab === tab && top.cardPath === cardPath) return;
    this.navHistory = this.navHistory.slice(0, this.navIndex + 1);
    this.navHistory.push({ tab, cardPath });
    this.navIndex = this.navHistory.length - 1;
    this.updateNavButtonStates();
  }
  updateNavButtonStates() {
    const canBack = this.navIndex > 0;
    const canForward = this.navIndex < this.navHistory.length - 1;
    for (const { back, fwd } of this.navButtons) {
      back.toggleAttribute("disabled", !canBack);
      fwd.toggleAttribute("disabled", !canForward);
    }
    this.cardNavButtons = this.cardNavButtons.filter(({ back }) => back.isConnected);
    const cardBack = this.cardNavTarget(-1) !== null;
    const cardFwd = this.cardNavTarget(1) !== null;
    for (const { back, fwd } of this.cardNavButtons) {
      back.toggleAttribute("disabled", !cardBack);
      fwd.toggleAttribute("disabled", !cardFwd);
    }
    this.refreshCurrentCardHighlight();
  }
  /**
   * The nearest history entry before (-1) or after (1) the current one that has an expanded card,
   * or null. Entries without one (a tab switch, or a card being closed) are skipped: the card
   * toolbar's Back / Forward step from one expanded entry to the next.
   */
  cardNavTarget(dir) {
    for (let i = this.navIndex + dir; i >= 0 && i < this.navHistory.length; i += dir) {
      if (this.navHistory[i].cardPath) return i;
    }
    return null;
  }
  /** Back / Forward from an expanded card's toolbar: expands the previous / next expanded entry in the history. */
  navigateCard(dir) {
    const target = this.cardNavTarget(dir);
    if (target === null) return;
    this.navIndex = target;
    this.applyNavEntry(this.navHistory[target]);
  }
  /**
   * Marks the card at the current point in the nav history (if any) as the "current" one, with an
   * accent-colored border, and makes sure it's the only card so marked. Derived fresh from
   * navHistory every time rather than tracked separately, so there's never more than one: expanding
   * or jumping to a different card, collapsing the current one, or stepping Back/Forward all just
   * change which entry (if any) is at navIndex, and this re-reads that.
   */
  refreshCurrentCardHighlight() {
    this.containerEl.querySelectorAll(".wb-card-current").forEach((el) => el.removeClass("wb-card-current"));
    const current = this.navHistory[this.navIndex];
    if (!(current == null ? void 0 : current.cardPath)) return;
    const pane = this.tabContents[current.tab];
    const card = pane == null ? void 0 : pane.body.querySelector(`.wb-card[data-path="${CSS.escape(current.cardPath)}"]`);
    card == null ? void 0 : card.addClass("wb-card-current");
  }
  navigateBack() {
    if (this.navIndex <= 0) return;
    this.navIndex--;
    this.applyNavEntry(this.navHistory[this.navIndex]);
  }
  navigateForward() {
    if (this.navIndex >= this.navHistory.length - 1) return;
    this.navIndex++;
    this.applyNavEntry(this.navHistory[this.navIndex]);
  }
  applyNavEntry(entry) {
    var _a, _b;
    this.restoringNav = true;
    try {
      this.switchTab(entry.tab);
      if (entry.cardPath) {
        this.revealCard(entry.tab, entry.cardPath);
      } else {
        const float = this.floating;
        const onTab = !!float && float.pane === ((_a = this.tabContents[entry.tab]) == null ? void 0 : _a.body);
        if (float && onTab && !(((_b = this.activeEdit) == null ? void 0 : _b.card) === float.card && this.activeEdit.isDirty())) {
          this.collapseCard(float.card, false);
        }
      }
    } finally {
      this.restoringNav = false;
    }
    this.updateNavButtonStates();
  }
  /**
   * Follows a wiki-link clicked inside an expanded card's preview: if the target note has its own
   * card somewhere in the sidebar, switches to that tab, expands its card and scrolls it into view
   * instead of opening the note in the main editor. Anything outside the tracked sections (or an
   * unresolved link) falls back to Obsidian's normal "open the note" behavior.
   */
  followWikiLink(linktext, sourcePath) {
    const linkPath = linktext.split("#")[0];
    const dest = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
    if (!dest) {
      new import_obsidian.Notice(`Couldn't find "${linktext}".`);
      return;
    }
    const tab = this.findEntryTab(dest);
    if (!tab) {
      void this.app.workspace.getLeaf().openFile(dest);
      return;
    }
    if (tab !== this.activeTab) this.switchTab(tab);
    this.revealCard(tab, dest.path);
  }
  /**
   * Brings one tab's card into view: un-collapses its group group if needed, clears an active
   * search filter that would otherwise hide it, expands it (recording that as a nav entry, same as
   * a direct click would), and scrolls it into view.
   */
  revealCard(tab, path) {
    var _a, _b, _c, _d;
    const pane = this.tabContents[tab];
    if (!pane) return;
    const card = pane.body.querySelector(`.wb-card[data-path="${CSS.escape(path)}"]`);
    if (!card) return;
    for (let list = card.closest(".wb-list"); list && list !== pane.body; list = (_b = (_a = list.parentElement) == null ? void 0 : _a.closest(".wb-list")) != null ? _b : null) {
      if (!list.classList.contains("is-collapsed")) continue;
      list.removeClass("is-collapsed");
      const header = list.previousElementSibling;
      if (header instanceof HTMLElement && header.classList.contains("wb-group-header")) {
        header.removeClass("is-collapsed");
        header.setAttribute("aria-expanded", "true");
      }
    }
    for (let el = card; el && el !== pane.body; el = el.parentElement) {
      if (!el.classList.contains("wb-tree-hidden")) continue;
      const owner = el.getAttribute("data-tree-owner");
      if (owner) void ((_c = this.treeExpanders.get(owner)) == null ? void 0 : _c());
    }
    if (card.classList.contains("wb-filtered-out") && this.searchQueries[tab]) {
      this.searchQueries[tab] = "";
      this.applySearch(tab);
      if (tab === this.activeTab) (_d = this.showTabSearchFn) == null ? void 0 : _d.call(this);
    }
    if (!card.classList.contains("wb-card-expanded")) {
      card.scrollIntoView({ block: "center" });
      const entry = this.entryByPath.get(path);
      if (entry) this.toggleCardExpand(tab, card, entry);
    }
  }
  /**
   * Lets an image file be dropped onto a portrait card (collapsed or expanded) to set its
   * portrait, from outside Obsidian (e.g. File Explorer) or from Obsidian's own file list. The
   * card is outlined while an image is over it. Drops meant for an open inline editor are left
   * to the editor, and card reorder drags (which carry application/x-wb-card) are ignored.
   */
  enableImageDrop(card, entry, title) {
    const isImage = (e) => isImageDrag(this.app, e);
    const overEditor = (e) => {
      var _a, _b;
      return ((_a = this.activeEdit) == null ? void 0 : _a.card) === card && e.target instanceof Node && !!((_b = card.querySelector(":scope > .wb-card-expand")) == null ? void 0 : _b.contains(e.target));
    };
    const clear = () => card.removeClass("wb-card-image-drop");
    card.addEventListener("dragenter", (e) => {
      if (!isImage(e) || overEditor(e)) return;
      e.preventDefault();
      card.addClass("wb-card-image-drop");
    });
    card.addEventListener("dragover", (e) => {
      if (!isImage(e)) return;
      if (overEditor(e)) {
        clear();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      card.addClass("wb-card-image-drop");
    });
    card.addEventListener("dragleave", (e) => {
      if (!card.contains(e.relatedTarget)) clear();
    });
    card.addEventListener("drop", (e) => {
      clear();
      if (!isImage(e) || overEditor(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const image = droppedImageFrom(this.app, e.dataTransfer);
      if (!image) return;
      if (this.activeEdit) {
        new import_obsidian.Notice("Finish editing the open entry before dropping an image.");
        return;
      }
      void this.setPortrait(entry.file, title, image);
    });
  }
  /**
   * Sets a note's portrait to a dropped image. If the note already embeds a portrait image, asks
   * before replacing it (declining changes nothing, and nothing is copied into the vault), then
   * swaps that embed for the new one in place, keeping any size spec. Otherwise the embed is
   * added at the very top of the note's body (right after the frontmatter, which has to stay first).
   * An image from outside the vault is copied into `<Universe folder>/Images/<Section>` (see
   * importImage), so the note never points at a file outside the vault.
   */
  async setPortrait(note, title, image) {
    var _a;
    try {
      const existing = this.findFirstImage(await this.app.vault.read(note), note);
      if (existing) {
        if (image.kind === "vault" && ((_a = existing.file) == null ? void 0 : _a.path) === image.file.path) {
          new import_obsidian.Notice(`"${image.file.name}" is already the portrait for "${title}".`);
          return;
        }
        const ok = await confirmModal(
          this.app,
          "Replace portrait?",
          `"${title}" already has a portrait (${existing.name}). Replace it with ${image.file.name}?`,
          "Replace"
        );
        if (!ok) return;
      }
      let imageFile;
      if (image.kind === "vault") {
        imageFile = image.file;
      } else {
        imageFile = await importImage(this.app, this.plugin.settings.worldFolder, image.file, note.path);
      }
      await this.app.vault.process(note, (data) => {
        const current = this.findFirstImage(data, note);
        if (current) return data.slice(0, current.start) + portraitEmbed(this.app, imageFile, note.path, current.size) + data.slice(current.end);
        return insertAtBodyTop(data, portraitEmbed(this.app, imageFile, note.path));
      });
      await this.render({ keepExpanded: true });
      new import_obsidian.Notice(`Portrait ${existing ? "replaced" : "added"} for "${title}".`);
    } catch (err) {
      console.error("Universe Builder: setting portrait failed", err);
      new import_obsidian.Notice(`Couldn't set the portrait for "${title}".`);
    }
  }
  /**
   * Makes the cards in one list drag-sortable (an group's character group, a hierarchical
   * tab's parent or child group, or a whole flat tab like Lore). Each list only accepts cards
   * that were picked up from that same list, so entries can't be dragged between groups,
   * between a parent's children and its siblings, or between tabs. Every DOM query here is
   * scoped to this list's own direct children (`:scope > .wb-card`) so a hierarchical tab's
   * nested child-group lists - which live inside this list's DOM subtree - are never touched by
   * an ancestor list's bookkeeping, and every listener stops propagation so a drag started in a
   * nested list isn't also seen by the (ancestor) lists it's nested inside. The new order is
   * handed to `onReorder` to persist to plugin data; notes themselves are never modified.
   */
  enableReorder(list, onReorder) {
    let dragged = null;
    let dropTarget = null;
    let dropAfter = false;
    const cardAt = (t) => t instanceof HTMLElement ? t.closest(".wb-card") : null;
    const unitOf = (card) => {
      const parts = [];
      const prev = card.previousElementSibling;
      if (prev instanceof HTMLElement && prev.classList.contains("wb-tree-header")) parts.push(prev);
      parts.push(card);
      const next = card.nextElementSibling;
      if (next instanceof HTMLElement && next.classList.contains("wb-child-group")) parts.push(next);
      return parts;
    };
    const clearMarks = () => {
      list.querySelectorAll(":scope > .wb-drop-before, :scope > .wb-drop-after").forEach(
        (el) => el.classList.remove("wb-drop-before", "wb-drop-after")
      );
      dropTarget = null;
    };
    list.querySelectorAll(":scope > .wb-card").forEach(
      (card) => card.setAttribute("draggable", "true")
    );
    list.addEventListener("dragstart", (e) => {
      var _a;
      const card = cardAt(e.target);
      if (!card || card.parentElement !== list || !e.dataTransfer) return;
      e.stopPropagation();
      dragged = card;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/x-wb-card", (_a = card.getAttribute("data-path")) != null ? _a : "");
      window.setTimeout(() => card.classList.add("wb-dragging"), 0);
    });
    list.addEventListener("dragend", () => {
      dragged == null ? void 0 : dragged.classList.remove("wb-dragging");
      dragged = null;
      clearMarks();
    });
    list.addEventListener("dragover", (e) => {
      if (!dragged) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const target = cardAt(e.target);
      if (!target || target.parentElement !== list) return;
      clearMarks();
      if (target === dragged) return;
      const r = target.getBoundingClientRect();
      dropTarget = target;
      dropAfter = e.clientY >= r.top + r.height / 2;
      const unit = unitOf(target);
      (dropAfter ? unit[unit.length - 1] : unit[0]).classList.add(dropAfter ? "wb-drop-after" : "wb-drop-before");
    });
    list.addEventListener("dragleave", (e) => {
      if (!list.contains(e.relatedTarget)) clearMarks();
    });
    const handleDrop = async (e) => {
      if (!dragged) return;
      e.preventDefault();
      e.stopPropagation();
      const moving = dragged;
      if (dropTarget && dropTarget !== moving) {
        const movingParts = unitOf(moving);
        const targetParts = unitOf(dropTarget);
        const ref = dropAfter ? targetParts[targetParts.length - 1].nextSibling : targetParts[0];
        if (!movingParts.includes(ref)) {
          for (const part of movingParts) list.insertBefore(part, ref);
        }
        const order = Array.from(list.querySelectorAll(":scope > .wb-card")).map(
          (c) => {
            var _a;
            return (_a = c.getAttribute("data-path")) != null ? _a : "";
          }
        );
        await onReorder(order);
      }
      clearMarks();
    };
    list.addEventListener("drop", (e) => void handleDrop(e));
  }
};
function splitFrontmatter(text) {
  const m = text.match(/^(---\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/);
  if (!m) return null;
  return { open: m[1], yaml: m[2], close: m[3], body: text.slice(m[0].length) };
}
function createAutoTextarea(parent, cls, value, label, keys) {
  const ta = parent.createEl("textarea", { cls, attr: { spellcheck: "true", "aria-label": label } });
  ta.value = value;
  const autosize = () => {
    ta.setCssStyles({ height: "auto" });
    ta.setCssStyles({ height: `${ta.scrollHeight + 2}px` });
  };
  ta.addEventListener("input", autosize);
  ta.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "s" || e.key === "Enter")) {
      e.preventDefault();
      keys.save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      keys.cancel();
    } else if (e.key === "Tab" && !mod && !e.altKey) {
      e.preventDefault();
      ta.setRangeText("	", ta.selectionStart, ta.selectionEnd, "end");
      autosize();
    }
  });
  window.requestAnimationFrame(autosize);
  return ta;
}
function createRawEditor(anchor, file, text, keys) {
  const wrap = createDiv("wb-card-editor-wrap");
  anchor.insertAdjacentElement("afterend", wrap);
  const ta = createAutoTextarea(wrap, "wb-card-editor", text, `Edit ${file.basename}`, keys);
  return {
    getText: () => ta.value,
    isDirty: () => ta.value !== text,
    focus: () => {
      ta.focus();
      ta.setSelectionRange(0, 0);
      ta.scrollTop = 0;
    },
    destroy: () => wrap.remove()
  };
}
var LIVE_PREVIEW_TEXT_SCALE = 0.75;
var livePreviewEditorClass;
function resolveLivePreviewEditorClass(app) {
  var _a, _b;
  if (livePreviewEditorClass !== void 0) return livePreviewEditorClass;
  livePreviewEditorClass = null;
  try {
    const registry = app.embedRegistry;
    const embed = (_b = (_a = registry == null ? void 0 : registry.embedByExtension) == null ? void 0 : _a.md) == null ? void 0 : _b.call(_a, { app, containerEl: createDiv(), state: {} }, null, "");
    if (embed) {
      embed.load();
      embed.editable = true;
      embed.showEditor();
      let ctor = null;
      if (embed.editMode) {
        const proto = Object.getPrototypeOf(Object.getPrototypeOf(embed.editMode));
        ctor = proto == null ? void 0 : proto.constructor;
      }
      embed.unload();
      if (typeof ctor === "function") livePreviewEditorClass = ctor;
    }
  } catch (err) {
    console.warn("Universe Builder: Live Preview editor unavailable (Obsidian internals changed?); using the raw markdown editor.", err);
  }
  return livePreviewEditorClass;
}
function createLivePreviewEditor(app, parent, anchor, file, text, keys, portrait = null) {
  const Base = resolveLivePreviewEditorClass(app);
  if (!Base) return null;
  const wrap = createDiv("wb-card-editor-wrap wb-card-editor-live");
  anchor.insertAdjacentElement("afterend", wrap);
  const fm = splitFrontmatter(text);
  let props = null;
  if (fm) {
    const toggle = wrap.createEl("button", {
      cls: "wb-card-editor-label wb-card-editor-props-toggle",
      attr: { type: "button", "aria-expanded": "false" }
    });
    (0, import_obsidian.setIcon)(toggle.createSpan({ cls: "wb-card-editor-props-chevron" }), "chevron-right");
    toggle.createSpan({ text: "Properties" });
    const count = fm.yaml.split(/\r?\n/).filter((line) => /^[^\s#-][^:]*:/.test(line)).length;
    if (count) toggle.createSpan({ cls: "wb-card-editor-props-count", text: `(${count})` });
    const box = createAutoTextarea(wrap, "wb-card-editor wb-card-editor-props", fm.yaml, `Properties of ${file.basename}`, keys);
    box.hide();
    props = box;
    toggle.onclick = () => {
      const open = !box.isShown();
      box.toggle(open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.toggleClass("is-open", open);
      if (open) box.dispatchEvent(new Event("input"));
    };
  }
  const host = wrap.createDiv("wb-card-editor-body");
  const baseSize = parseFloat(getComputedStyle(host).getPropertyValue("--font-text-size")) || 16;
  host.style.setProperty("--font-text-size", `${baseSize * LIVE_PREVIEW_TEXT_SCALE}px`);
  let cmp = null;
  const owner = {
    app,
    hoverPopover: null,
    showSearch: () => {
    },
    toggleMode: () => {
    },
    onMarkdownScroll: () => {
    },
    getMode: () => "source",
    scroll: 0,
    editMode: null,
    get editor() {
      return cmp == null ? void 0 : cmp.editor;
    },
    get file() {
      return file;
    },
    get path() {
      return file.path;
    }
  };
  const vaultProxy = new Proxy(app.vault, {
    get(target, prop, receiver) {
      var _a;
      if (prop === "config") {
        const config = (_a = target.config) != null ? _a : {};
        return new Proxy(config, {
          get(cfg, key, r) {
            if (key === "showLineNumber" || key === "foldHeading" || key === "foldIndent") return false;
            return Reflect.get(cfg, key, r);
          }
        });
      }
      return Reflect.get(target, prop, receiver);
    }
  });
  const appProxy = new Proxy(app, {
    get(target, prop, receiver) {
      return prop === "vault" ? vaultProxy : Reflect.get(target, prop, receiver);
    }
  });
  const fullBody = fm ? fm.body : text;
  let lead = "";
  const bodyOffset = text.length - fullBody.length;
  if (portrait && portrait.start >= bodyOffset) {
    const start = portrait.start - bodyOffset;
    const end = portrait.end - bodyOffset;
    const lineEnd = fullBody.slice(end).match(/^[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)*/);
    if (!fullBody.slice(0, start).trim() && lineEnd) lead = fullBody.slice(0, end + lineEnd[0].length);
  }
  const heading = fullBody.slice(lead.length).match(/^(?:[ \t]*\r?\n)*# [^\r\n]*(?:\r?\n|$)(?:[ \t]*\r?\n)*/);
  if (heading) lead += heading[0];
  const bodyText = fullBody.slice(lead.length);
  let initialBody = bodyText;
  try {
    class SidebarMarkdownEditor extends Base {
      // The stock editor pads the bottom so the last line can scroll to mid-screen; not wanted in a card.
      updateBottomPadding() {
      }
    }
    const editor = new SidebarMarkdownEditor(appProxy, host, owner);
    cmp = editor;
    parent.addChild(editor);
    owner.editMode = editor;
    editor.set(bodyText);
    initialBody = getBodyValue();
  } catch (err) {
    console.warn("Universe Builder: couldn't create the Live Preview editor; using the raw markdown editor.", err);
    try {
      if (cmp) parent.removeChild(cmp);
    } catch (e) {
    }
    wrap.remove();
    return null;
  }
  function getBodyValue() {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    return (_h = (_g = (_b = (_a = cmp == null ? void 0 : cmp.editor) == null ? void 0 : _a.getValue) == null ? void 0 : _b.call(_a)) != null ? _g : (_f = (_e = (_d = (_c = cmp == null ? void 0 : cmp.cm) == null ? void 0 : _c.state) == null ? void 0 : _d.doc) == null ? void 0 : _e.toString) == null ? void 0 : _f.call(_e)) != null ? _h : bodyText;
  }
  const scope = new import_obsidian.Scope(app.scope);
  scope.register(["Mod"], "s", () => {
    keys.save();
    return false;
  });
  scope.register(["Mod"], "Enter", () => {
    keys.save();
    return false;
  });
  scope.register([], "Escape", () => {
    keys.cancel();
    return false;
  });
  let scopePushed = false;
  const popScope = () => {
    if (scopePushed) app.keymap.popScope(scope);
    scopePushed = false;
  };
  host.addEventListener("focusin", () => {
    if (!scopePushed) {
      app.keymap.pushScope(scope);
      scopePushed = true;
    }
    app.workspace.activeEditor = owner;
  });
  host.addEventListener("focusout", (e) => {
    if (!host.contains(e.relatedTarget)) popScope();
  });
  const bodyChanged = () => getBodyValue() !== initialBody;
  const propsChanged = () => !!fm && !!props && props.value !== fm.yaml;
  let destroyed = false;
  return {
    getText: () => {
      if (!bodyChanged() && !propsChanged()) return text;
      const newBody = lead + (bodyChanged() ? getBodyValue() : bodyText);
      if (!fm || !props) return newBody;
      if (!props.value.trim()) return newBody;
      return fm.open + props.value + fm.close + newBody;
    },
    isDirty: () => bodyChanged() || propsChanged(),
    focus: () => {
      var _a, _b;
      try {
        (_b = (_a = cmp == null ? void 0 : cmp.editor) == null ? void 0 : _a.focus) == null ? void 0 : _b.call(_a);
      } catch (e) {
      }
      host.scrollTop = 0;
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      popScope();
      if (app.workspace.activeEditor === owner) app.workspace.activeEditor = null;
      try {
        if (cmp) parent.removeChild(cmp);
      } catch (e) {
      }
      wrap.remove();
    }
  };
}
function confirmModal(app, title, message, actionLabel) {
  return new Promise((resolve) => {
    let result = false;
    const modal = new import_obsidian.Modal(app);
    modal.titleEl.setText(title);
    modal.contentEl.createEl("p", { text: message });
    const buttons = modal.contentEl.createDiv("wb-confirm-buttons");
    const cancelBtn = buttons.createEl("button", { text: "Cancel", cls: "wb-btn-secondary", attr: { type: "button" } });
    cancelBtn.onclick = () => modal.close();
    const okBtn = buttons.createEl("button", { text: actionLabel, cls: "wb-btn-primary", attr: { type: "button" } });
    okBtn.onclick = () => {
      result = true;
      modal.close();
    };
    modal.onClose = () => resolve(result);
    modal.open();
    cancelBtn.focus();
  });
}
var PortraitPicker = class {
  /**
   * `sectionFolder` is the folder the note is (or will be) in, e.g. "UniverseBuilder/Lore"; it only
   * sets which Images subfolder the hint names. `dropGuard` (a modal) also swallows files let go
   * anywhere else inside it.
   */
  constructor(app, plugin, parent, sectionFolder, dropGuard) {
    this.app = app;
    this.plugin = plugin;
    this.image = null;
    this.objectUrl = null;
    const folder = portraitFolderFor(plugin.settings.worldFolder, `${sectionFolder}/_.md`);
    this.zone = parent.createDiv({
      cls: "wb-portrait-drop",
      attr: { role: "button", tabindex: "0", "aria-label": "Portrait: drop an image here, or press Enter to choose one" }
    });
    const preview = this.zone.createDiv("wb-portrait-drop-preview");
    this.previewImg = preview.createEl("img", { attr: { alt: "", draggable: "false" } });
    (0, import_obsidian.setIcon)(preview.createDiv("wb-portrait-drop-icon"), "image-plus");
    const text = this.zone.createDiv("wb-portrait-drop-text");
    text.createDiv({ cls: "wb-portrait-drop-title", text: "Drag and drop an image here to import it into the vault" });
    this.nameEl = text.createDiv({ cls: "wb-portrait-drop-name" });
    text.createDiv({ cls: "wb-portrait-drop-hint", text: `Or click to choose a file. It becomes the entry's portrait and is saved to ${folder}/.` });
    const removeBtn = this.zone.createEl("button", {
      cls: "wb-portrait-drop-remove clickable-icon",
      attr: { type: "button", "aria-label": "Remove image" }
    });
    (0, import_obsidian.setIcon)(removeBtn, "x");
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      this.set(null);
    };
    const input = parent.createEl("input", {
      cls: "wb-portrait-drop-input",
      attr: { type: "file", accept: "image/*,.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp,.avif", tabindex: "-1" }
    });
    input.onchange = () => {
      var _a;
      const picked = imageFromFiles(this.app, Array.from((_a = input.files) != null ? _a : []));
      if (picked) this.set(picked);
      input.value = "";
    };
    this.zone.onclick = () => input.click();
    this.zone.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        input.click();
      }
    };
    const clear = () => this.zone.removeClass("is-dragover");
    this.zone.addEventListener("dragenter", (e) => {
      if (!isImageDrag(this.app, e)) return;
      e.preventDefault();
      this.zone.addClass("is-dragover");
    });
    this.zone.addEventListener("dragover", (e) => {
      if (!isImageDrag(this.app, e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      this.zone.addClass("is-dragover");
    });
    this.zone.addEventListener("dragleave", (e) => {
      if (!this.zone.contains(e.relatedTarget)) clear();
    });
    this.zone.addEventListener("drop", (e) => {
      clear();
      if (!isImageDrag(this.app, e)) return;
      e.preventDefault();
      e.stopPropagation();
      const image = droppedImageFrom(this.app, e.dataTransfer);
      if (image) this.set(image);
    });
    dropGuard == null ? void 0 : dropGuard.addEventListener("dragover", (e) => {
      var _a;
      if (!((_a = e.dataTransfer) == null ? void 0 : _a.types.includes("Files")) || this.zone.contains(e.target)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "none";
    });
    dropGuard == null ? void 0 : dropGuard.addEventListener("drop", (e) => {
      var _a;
      if (((_a = e.dataTransfer) == null ? void 0 : _a.types.includes("Files")) && !this.zone.contains(e.target)) e.preventDefault();
    });
  }
  /** True once an image has been chosen (and not removed). */
  get hasImage() {
    return this.image !== null;
  }
  set(image) {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.image = image;
    if (!image) {
      this.previewImg.removeAttribute("src");
    } else if (image.kind === "vault") {
      this.previewImg.src = this.app.vault.getResourcePath(image.file);
    } else {
      this.objectUrl = URL.createObjectURL(image.file);
      this.previewImg.src = this.objectUrl;
    }
    this.nameEl.setText(image ? image.kind === "vault" ? `${image.file.name} (already in the vault)` : image.file.name : "");
    this.zone.toggleClass("has-image", !!image);
  }
  /**
   * Called once the note exists (or its edits are saved): imports the chosen image (if it came
   * from outside the vault) and embeds it at the top of the note. A failure here doesn't undo the
   * note itself; `failNotice` says so. Returns true if a portrait was added.
   */
  async attachTo(note, failNotice) {
    const image = this.image;
    if (!image) return false;
    try {
      const imageFile = image.kind === "vault" ? image.file : await importImage(this.app, this.plugin.settings.worldFolder, image.file, note.path);
      await this.app.vault.process(note, (data) => insertAtBodyTop(data, portraitEmbed(this.app, imageFile, note.path)));
      return true;
    } catch (err) {
      console.error("Universe Builder: importing portrait failed", err);
      new import_obsidian.Notice(failNotice);
      return false;
    }
  }
  /** Removes the drop area from the page and releases the preview's temporary URL. */
  remove() {
    this.destroy();
    this.zone.remove();
  }
  /** Releases the preview's temporary URL (call from the modal's onClose). */
  destroy() {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
};
var CharacterModal = class extends import_obsidian.Modal {
  constructor(app, plugin, onDone) {
    super(app);
    this.portrait = null;
    this.data = {
      name: "",
      role: "protagonist",
      age: "",
      group: "",
      ship: "",
      home: "",
      physicalDesc: "",
      personality: "",
      goals: ""
    };
    this.plugin = plugin;
    this.onDone = onDone;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("wb-modal");
    contentEl.createEl("h2", { text: "New Character" });
    this.portrait = new PortraitPicker(this.app, this.plugin, contentEl, `${this.plugin.settings.worldFolder}/Characters`, this.modalEl);
    new import_obsidian.Setting(contentEl).setName("Name").addText((t) => {
      t.setPlaceholder("Character name").onChange((v) => this.data.name = v);
    });
    new import_obsidian.Setting(contentEl).setName("Role").addDropdown((d) => {
      ["protagonist", "antagonist", "supporting", "minor"].forEach((o) => {
        d.addOption(o, o.charAt(0).toUpperCase() + o.slice(1));
      });
      d.setValue(this.data.role);
      d.onChange((v) => this.data.role = v);
    });
    new import_obsidian.Setting(contentEl).setName("Age").addText((t) => {
      t.setPlaceholder("e.g. 34").onChange((v) => this.data.age = v);
    });
    new import_obsidian.Setting(contentEl).setName("Group").addText((t) => {
      t.setPlaceholder("Group name").onChange((v) => this.data.group = v);
    });
    new import_obsidian.Setting(contentEl).setName("Ship").addText((t) => {
      t.setPlaceholder("Ship name").onChange((v) => this.data.ship = v);
    });
    new import_obsidian.Setting(contentEl).setName("Home").addText((t) => {
      t.setPlaceholder("Home name").onChange((v) => this.data.home = v);
    });
    new import_obsidian.Setting(contentEl).setName("Physical Description").addTextArea((t) => {
      t.inputEl.addClass("wb-textarea");
      t.onChange((v) => this.data.physicalDesc = v);
    });
    new import_obsidian.Setting(contentEl).setName("Personality").addTextArea((t) => {
      t.inputEl.addClass("wb-textarea");
      t.onChange((v) => this.data.personality = v);
    });
    new import_obsidian.Setting(contentEl).setName("Goals").addTextArea((t) => {
      t.inputEl.addClass("wb-textarea");
      t.onChange((v) => this.data.goals = v);
    });
    new import_obsidian.Setting(contentEl).addButton(
      (b) => b.setButtonText("Create").setCta().onClick(() => void this.submit())
    );
  }
  async submit() {
    var _a;
    if (!this.data.name.trim()) {
      new import_obsidian.Notice("Name is required.");
      return;
    }
    const folder = `${this.plugin.settings.worldFolder}/Characters`;
    const sections = [
      ["Origin", ""],
      ["Physical Description", this.data.physicalDesc],
      ["Occupation", ""],
      ["Resume", ""],
      ["Role In Story", ""],
      ["Goals", this.data.goals],
      ["Personality", this.data.personality],
      ["Habits/Mannerisms", ""],
      ["Earlier Life", ""],
      ["Internal Conflicts", ""],
      ["External Conflicts", ""]
    ];
    const sectionLines = [];
    for (const [heading, text] of sections) {
      sectionLines.push(`## ${heading}`);
      if (text) sectionLines.push(text);
      sectionLines.push("");
    }
    const content = [
      "---",
      `name: "${this.data.name}"`,
      `role: ${this.data.role}`,
      `age: "${this.data.age}"`,
      `group: "${this.data.group}"`,
      `ship: "${this.data.ship}"`,
      `home: "${this.data.home}"`,
      `type: character`,
      "---",
      "",
      `# ${this.data.name}`,
      "",
      ...sectionLines
    ].join("\n");
    const file = await createNote(this.app, folder, this.data.name, content);
    await ((_a = this.portrait) == null ? void 0 : _a.attachTo(file, `"${file.basename}" was created, but its portrait couldn't be imported.`));
    new import_obsidian.Notice(`Character "${this.data.name}" created.`);
    this.close();
    this.onDone();
    await this.app.workspace.getLeaf().openFile(file);
  }
  onClose() {
    var _a;
    (_a = this.portrait) == null ? void 0 : _a.destroy();
    this.contentEl.empty();
  }
};
var LocationModal = class extends import_obsidian.Modal {
  constructor(app, plugin, onDone) {
    super(app);
    this.portrait = null;
    this.data = {
      name: "",
      type: "planet",
      parent: "",
      description: "",
      inhabitants: "",
      secrets: ""
    };
    this.plugin = plugin;
    this.onDone = onDone;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("wb-modal");
    contentEl.createEl("h2", { text: "New Location" });
    this.portrait = new PortraitPicker(this.app, this.plugin, contentEl, `${this.plugin.settings.worldFolder}/Locations`, this.modalEl);
    new import_obsidian.Setting(contentEl).setName("Name").addText((t) => {
      t.setPlaceholder("Location name").onChange((v) => this.data.name = v);
    });
    new import_obsidian.Setting(contentEl).setName("Type").addDropdown((d) => {
      ["planet", "dwarf planet", "moon", "station", "asteroid", "belt", "ship", "city", "region", "building", "landmark", "other"].forEach((o) => {
        d.addOption(o, o.charAt(0).toUpperCase() + o.slice(1));
      });
      d.setValue(this.data.type);
      d.onChange((v) => this.data.type = v);
    });
    new import_obsidian.Setting(contentEl).setName("Parent Location").addText((t) => {
      t.setPlaceholder("e.g. The Northern Kingdom").onChange((v) => this.data.parent = v);
    });
    new import_obsidian.Setting(contentEl).setName("Description").addTextArea((t) => {
      t.inputEl.addClass("wb-textarea");
      t.onChange((v) => this.data.description = v);
    });
    new import_obsidian.Setting(contentEl).setName("Who Lives Here").addTextArea((t) => {
      t.inputEl.addClass("wb-textarea");
      t.onChange((v) => this.data.inhabitants = v);
    });
    new import_obsidian.Setting(contentEl).setName("Secrets").addTextArea((t) => {
      t.inputEl.addClass("wb-textarea");
      t.onChange((v) => this.data.secrets = v);
    });
    new import_obsidian.Setting(contentEl).addButton(
      (b) => b.setButtonText("Create").setCta().onClick(() => void this.submit())
    );
  }
  async submit() {
    var _a;
    if (!this.data.name.trim()) {
      new import_obsidian.Notice("Name is required.");
      return;
    }
    const folder = `${this.plugin.settings.worldFolder}/Locations`;
    const parentLink = this.data.parent ? `[[${this.data.parent}]]` : "";
    const content = [
      "---",
      `name: "${this.data.name}"`,
      `type: ${this.data.type}`,
      `parent: "${this.data.parent}"`,
      `entry_type: location`,
      "---",
      "",
      `# ${this.data.name}`,
      "",
      ...parentLink ? [`**Part of:** ${parentLink}`, ""] : [],
      "## Description",
      this.data.description || "_None provided._",
      "",
      "## Who Lives Here",
      this.data.inhabitants || "_None provided._",
      "",
      "## Secrets",
      this.data.secrets || "_None provided._"
    ].join("\n");
    const file = await createNote(this.app, folder, this.data.name, content);
    await ((_a = this.portrait) == null ? void 0 : _a.attachTo(file, `"${file.basename}" was created, but its portrait couldn't be imported.`));
    new import_obsidian.Notice(`Location "${this.data.name}" created.`);
    this.close();
    this.onDone();
    await this.app.workspace.getLeaf().openFile(file);
  }
  onClose() {
    var _a;
    (_a = this.portrait) == null ? void 0 : _a.destroy();
    this.contentEl.empty();
  }
};
var GroupModal = class extends import_obsidian.Modal {
  constructor(app, plugin, onDone) {
    super(app);
    this.portrait = null;
    this.data = {
      name: "",
      type: "corporation",
      subsidiaryOf: "",
      alignment: "neutral",
      goals: "",
      enemies: "",
      allies: "",
      description: ""
    };
    this.plugin = plugin;
    this.onDone = onDone;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("wb-modal");
    contentEl.createEl("h2", { text: "New Group" });
    this.portrait = new PortraitPicker(this.app, this.plugin, contentEl, `${this.plugin.settings.worldFolder}/Groups`, this.modalEl);
    new import_obsidian.Setting(contentEl).setName("Name").addText((t) => {
      t.setPlaceholder("Group name").onChange((v) => this.data.name = v);
    });
    new import_obsidian.Setting(contentEl).setName("Type").addDropdown((d) => {
      GROUP_TYPES.forEach(({ key, label }) => {
        d.addOption(key, label);
      });
      d.setValue(this.data.type);
      d.onChange((v) => this.data.type = v);
    });
    const folder = `${this.plugin.settings.worldFolder}/Groups`;
    const existing = Array.from(new Set(
      getMarkdownFilesIn(this.app, folder).map((f) => {
        var _a, _b;
        const name = (_b = (_a = this.app.metadataCache.getFileCache(f)) == null ? void 0 : _a.frontmatter) == null ? void 0 : _b.name;
        return typeof name === "string" && name.trim() ? name.trim() : f.basename;
      })
    )).sort((a, b) => a.localeCompare(b));
    new import_obsidian.Setting(contentEl).setName("Subsidiary of").setDesc("Nests this group under its parent's Subsidiaries label instead of its Type section.").addDropdown((d) => {
      d.addOption("", "None");
      existing.forEach((n) => {
        d.addOption(n, n);
      });
      d.setValue(this.data.subsidiaryOf);
      d.onChange((v) => this.data.subsidiaryOf = v);
    });
    new import_obsidian.Setting(contentEl).setName("Alignment").addDropdown((d) => {
      ["lawful", "neutral", "chaotic"].forEach((o) => {
        d.addOption(o, o.charAt(0).toUpperCase() + o.slice(1));
      });
      d.setValue(this.data.alignment);
      d.onChange((v) => this.data.alignment = v);
    });
    new import_obsidian.Setting(contentEl).setName("Goals").addTextArea((t) => {
      t.inputEl.addClass("wb-textarea");
      t.onChange((v) => this.data.goals = v);
    });
    new import_obsidian.Setting(contentEl).setName("Enemies").addText((t) => {
      t.setPlaceholder("Comma-separated").onChange((v) => this.data.enemies = v);
    });
    new import_obsidian.Setting(contentEl).setName("Allies").addText((t) => {
      t.setPlaceholder("Comma-separated").onChange((v) => this.data.allies = v);
    });
    new import_obsidian.Setting(contentEl).setName("Description").addTextArea((t) => {
      t.inputEl.addClass("wb-textarea");
      t.onChange((v) => this.data.description = v);
    });
    new import_obsidian.Setting(contentEl).addButton(
      (b) => b.setButtonText("Create").setCta().onClick(() => void this.submit())
    );
  }
  async submit() {
    var _a, _b, _c;
    if (!this.data.name.trim()) {
      new import_obsidian.Notice("Name is required.");
      return;
    }
    const folder = `${this.plugin.settings.worldFolder}/Groups`;
    const enemyLinks = this.data.enemies.split(",").filter(Boolean).map((e) => `[[${e.trim()}]]`).join(", ");
    const allyLinks = this.data.allies.split(",").filter(Boolean).map((a) => `[[${a.trim()}]]`).join(", ");
    const lines = [
      "---",
      `name: "${this.data.name}"`,
      `type: ${this.data.type}`,
      `${SUBSIDIARY_OF}: "${this.data.subsidiaryOf.replace(/"/g, "'")}"`,
      `alignment: ${this.data.alignment}`,
      `goals: "${this.data.goals.replace(/"/g, "'")}"`,
      `entry_type: group`,
      "---",
      "",
      `# ${this.data.name}`,
      "",
      `**Type:** ${(_b = (_a = GROUP_TYPES.find((t) => t.key === this.data.type)) == null ? void 0 : _a.label) != null ? _b : this.data.type}`,
      ...this.data.subsidiaryOf ? [`**Subsidiary of:** [[${this.data.subsidiaryOf}]]`] : [],
      `**Alignment:** ${this.data.alignment}`
    ];
    if (enemyLinks) lines.push(`**Enemies:** ${enemyLinks}`);
    if (allyLinks) lines.push(`**Allies:** ${allyLinks}`);
    lines.push("", "## Goals", this.data.goals || "_None provided._", "", "## Description", this.data.description || "_None provided._");
    const file = await createNote(this.app, folder, this.data.name, lines.join("\n"));
    await ((_c = this.portrait) == null ? void 0 : _c.attachTo(file, `"${file.basename}" was created, but its portrait couldn't be imported.`));
    new import_obsidian.Notice(`Group "${this.data.name}" created.`);
    this.close();
    this.onDone();
    await this.app.workspace.getLeaf().openFile(file);
  }
  onClose() {
    var _a;
    (_a = this.portrait) == null ? void 0 : _a.destroy();
    this.contentEl.empty();
  }
};
var LoreModal = class extends import_obsidian.Modal {
  constructor(app, plugin, onDone) {
    super(app);
    this.portrait = null;
    this.data = { title: "", category: "history", content: "" };
    this.plugin = plugin;
    this.onDone = onDone;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("wb-modal");
    contentEl.createEl("h2", { text: "New Lore Entry" });
    this.portrait = new PortraitPicker(this.app, this.plugin, contentEl, `${this.plugin.settings.worldFolder}/Lore`, this.modalEl);
    new import_obsidian.Setting(contentEl).setName("Title").addText((t) => {
      t.setPlaceholder("Entry title").onChange((v) => this.data.title = v);
    });
    new import_obsidian.Setting(contentEl).setName("Category").addDropdown((d) => {
      ["history", "tech", "religion", "culture", "other"].forEach((o) => {
        d.addOption(o, o.charAt(0).toUpperCase() + o.slice(1));
      });
      d.setValue(this.data.category);
      d.onChange((v) => this.data.category = v);
    });
    new import_obsidian.Setting(contentEl).setName("Content").addTextArea((t) => {
      t.inputEl.addClasses(["wb-textarea", "wb-textarea-tall"]);
      t.onChange((v) => this.data.content = v);
    });
    new import_obsidian.Setting(contentEl).addButton(
      (b) => b.setButtonText("Create").setCta().onClick(() => void this.submit())
    );
  }
  async submit() {
    var _a;
    if (!this.data.title.trim()) {
      new import_obsidian.Notice("Title is required.");
      return;
    }
    const folder = `${this.plugin.settings.worldFolder}/Lore`;
    const content = [
      "---",
      `title: "${this.data.title}"`,
      `category: ${this.data.category}`,
      `entry_type: lore`,
      "---",
      "",
      `# ${this.data.title}`,
      "",
      `*Category: ${this.data.category}*`,
      "",
      this.data.content || "_No content yet._"
    ].join("\n");
    const file = await createNote(this.app, folder, this.data.title, content);
    await ((_a = this.portrait) == null ? void 0 : _a.attachTo(file, `"${file.basename}" was created, but its portrait couldn't be imported.`));
    new import_obsidian.Notice(`Lore entry "${this.data.title}" created.`);
    this.close();
    this.onDone();
    await this.app.workspace.getLeaf().openFile(file);
  }
  onClose() {
    var _a;
    (_a = this.portrait) == null ? void 0 : _a.destroy();
    this.contentEl.empty();
  }
};
var TimelineModal = class extends import_obsidian.Modal {
  constructor(app, plugin, onDone) {
    super(app);
    this.portrait = null;
    this.data = { date: "", title: "", description: "", characters: "", locations: "" };
    this.plugin = plugin;
    this.onDone = onDone;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("wb-modal");
    contentEl.createEl("h2", { text: "New Timeline Event" });
    this.portrait = new PortraitPicker(this.app, this.plugin, contentEl, `${this.plugin.settings.worldFolder}/Timeline`, this.modalEl);
    new import_obsidian.Setting(contentEl).setName("Date / Era").addText((t) => {
      t.setPlaceholder("e.g. Year 342 AE").onChange((v) => this.data.date = v);
    });
    new import_obsidian.Setting(contentEl).setName("Title").addText((t) => {
      t.setPlaceholder("Event title").onChange((v) => this.data.title = v);
    });
    new import_obsidian.Setting(contentEl).setName("Description").addTextArea((t) => {
      t.inputEl.addClass("wb-textarea");
      t.onChange((v) => this.data.description = v);
    });
    new import_obsidian.Setting(contentEl).setName("Linked Characters").addText((t) => {
      t.setPlaceholder("Comma-separated names").onChange((v) => this.data.characters = v);
    });
    new import_obsidian.Setting(contentEl).setName("Linked Locations").addText((t) => {
      t.setPlaceholder("Comma-separated names").onChange((v) => this.data.locations = v);
    });
    new import_obsidian.Setting(contentEl).addButton(
      (b) => b.setButtonText("Create").setCta().onClick(() => void this.submit())
    );
  }
  async submit() {
    var _a;
    if (!this.data.title.trim()) {
      new import_obsidian.Notice("Title is required.");
      return;
    }
    const folder = `${this.plugin.settings.worldFolder}/Timeline`;
    const charLinks = this.data.characters.split(",").filter(Boolean).map((c) => `[[${c.trim()}]]`).join(", ");
    const locLinks = this.data.locations.split(",").filter(Boolean).map((l) => `[[${l.trim()}]]`).join(", ");
    const filename = this.data.date ? `${this.data.date} - ${this.data.title}` : this.data.title;
    const lines = [
      "---",
      `title: "${this.data.title}"`,
      `date: "${this.data.date}"`,
      `entry_type: timeline`,
      "---",
      "",
      `# ${this.data.title}`,
      "",
      `**Date/Era:** ${this.data.date || "_Unknown_"}`
    ];
    if (charLinks) lines.push(`**Characters:** ${charLinks}`);
    if (locLinks) lines.push(`**Locations:** ${locLinks}`);
    lines.push("", "## Description", this.data.description || "_None provided._");
    const file = await createNote(this.app, folder, filename, lines.join("\n"));
    await ((_a = this.portrait) == null ? void 0 : _a.attachTo(file, `"${file.basename}" was created, but its portrait couldn't be imported.`));
    new import_obsidian.Notice(`Timeline event "${this.data.title}" created.`);
    this.close();
    this.onDone();
    await this.app.workspace.getLeaf().openFile(file);
  }
  onClose() {
    var _a;
    (_a = this.portrait) == null ? void 0 : _a.destroy();
    this.contentEl.empty();
  }
};
var FolderMigrationModal = class extends import_obsidian.Modal {
  constructor(app, info, onChoose) {
    super(app);
    this.info = info;
    this.onChoose = onChoose;
    this.choice = "ask-later";
  }
  onOpen() {
    const { contentEl } = this;
    const { source, sections, worldBuilder } = this.info;
    contentEl.addClass("wb-modal", "wb-migrate-modal");
    this.setTitle("Universe Builder now has its own folder");
    const total = sections.reduce((n, s) => n + s.count, 0);
    const found = sections.map((s) => `${s.label} (${s.count})`).join(", ");
    contentEl.createEl("p", {
      text: `Your Universe Builder notes are in "${source}/", a folder other plugins may also use. Universe Builder now keeps its notes in "${DEFAULT_FOLDER}/" instead.`
    });
    contentEl.createEl("p", {
      text: `Moving only covers the Characters, Groups, Locations, Lore, Timeline and ${IMAGES_SUBFOLDER} folders in "${source}/". Found: ${found}, ${total} file${total === 1 ? "" : "s"} in all. Anything else in "${source}/" stays where it is. Links between notes keep working.`
    });
    if (worldBuilder) {
      contentEl.createEl("p", {
        cls: "wb-migrate-warning",
        text: `The World Builder plugin is installed in this vault (${worldBuilder}). After moving, it will no longer see these notes.`
      });
    }
    contentEl.createEl("p", {
      cls: "wb-migrate-note",
      text: `Folder paths typed into other plugins or notes (for example a Dataview query on "${source}") aren't updated.`
    });
    const buttons = contentEl.createDiv({ cls: "wb-migrate-buttons" });
    const add = (text, choice, cta = false) => {
      const btn = buttons.createEl("button", { text });
      if (cta) btn.addClass("mod-cta");
      btn.addEventListener("click", () => {
        this.choice = choice;
        this.close();
      });
    };
    add(`Move to ${DEFAULT_FOLDER}/ (recommended)`, "move", true);
    add(`Keep ${source}/, ask again next update`, "ask-later");
    add(`Keep ${source}/, don't ask again`, "decline");
  }
  onClose() {
    this.contentEl.empty();
    this.onChoose(this.choice);
  }
};
var LegacyCleanupModal = class extends import_obsidian.Modal {
  constructor(app, folder, emptyFolders, onChoose) {
    super(app);
    this.folder = folder;
    this.emptyFolders = emptyFolders;
    this.onChoose = onChoose;
    this.choice = null;
  }
  onOpen() {
    const { contentEl, folder, emptyFolders } = this;
    contentEl.addClass("wb-modal", "wb-migrate-modal");
    this.setTitle(`Delete the empty "${folder}" folder?`);
    contentEl.createEl("p", {
      text: `Your notes are now in "${DEFAULT_FOLDER}/", and "${folder}/" has no files left in it` + (emptyFolders.length ? ` (only empty folders: ${emptyFolders.join(", ")}).` : ".") + " Nothing uses it any more, so it can be deleted."
    });
    contentEl.createEl("p", {
      cls: "wb-migrate-note",
      text: `Deleted folders go to the trash, following Obsidian's "Deleted files" setting.`
    });
    const buttons = contentEl.createDiv({ cls: "wb-migrate-buttons" });
    const add = (text, choice, cta = false) => {
      const btn = buttons.createEl("button", { text });
      if (cta) btn.addClass("mod-cta");
      btn.addEventListener("click", () => {
        this.choice = choice;
        this.close();
      });
    };
    add(`Delete ${folder}/`, "delete", true);
    add(`Keep ${folder}/`, "keep");
  }
  onClose() {
    this.contentEl.empty();
    this.onChoose(this.choice);
  }
};
var UniverseBuilderSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  /**
   * Declarative settings (Obsidian 1.13.0+). Obsidian renders these, indexes them for settings
   * search, and reads/writes values through getControlValue/setControlValue below. Keep this
   * cheap: it runs on every update() and once when the tab is registered.
   */
  getSettingDefinitions() {
    return [
      {
        name: "Universe folder",
        desc: `Root folder for all Universe Builder notes. Changing it doesn't move existing notes; to move notes out of an old "World" folder, run the "Move notes out of the World folder" command.`,
        aliases: ["world folder", "root", "directory", "path"],
        control: {
          type: "text",
          key: "worldFolder",
          placeholder: DEFAULT_SETTINGS.worldFolder,
          defaultValue: DEFAULT_SETTINGS.worldFolder
        }
      },
      {
        name: "Sidebar editor",
        desc: "What the Edit button on an expanded entry opens. Live Preview uses Obsidian's own editor (formatting shown as you type, [[link]] suggestions); Raw markdown is a plain text box. If Live Preview ever stops working after an Obsidian update, the plugin falls back to Raw markdown on its own.",
        aliases: ["live preview", "raw markdown", "edit"],
        control: {
          type: "dropdown",
          key: "inlineEditor",
          options: { live: "Live Preview", raw: "Raw markdown" },
          defaultValue: DEFAULT_SETTINGS.inlineEditor
        }
      }
    ];
  }
  /**
   * Normalises values before they are stored, preserving the rules the old imperative tab
   * applied in its onChange handlers: an empty folder falls back to the default, and the
   * editor choice is always "live" or "raw".
   */
  async setControlValue(key, value) {
    const settings = this.plugin.settings;
    switch (key) {
      case "worldFolder":
        settings.worldFolder = typeof value === "string" && value || DEFAULT_SETTINGS.worldFolder;
        break;
      case "inlineEditor":
        settings.inlineEditor = value === "raw" ? "raw" : "live";
        break;
      default:
        return;
    }
    await this.plugin.saveSettings();
  }
};
var UniverseBuilderPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    // ─── Folder migration (World/ -> UniverseBuilder/) ───────────────────────────
    /** Set while the prompt is open or a move is running, so the check never runs twice at once. */
    this.migrationBusy = false;
  }
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new UniverseBuilderView(leaf, this));
    this.addRibbonIcon("orbit", "Universe Builder", () => void this.activateSidebar());
    this.addCommand({
      id: "open-sidebar",
      name: "Open sidebar",
      callback: () => void this.activateSidebar()
    });
    this.addCommand({
      id: "new-character",
      name: "New Character",
      callback: () => new CharacterModal(this.app, this, () => this.refreshSidebar()).open()
    });
    this.addCommand({
      id: "new-location",
      name: "New Location",
      callback: () => new LocationModal(this.app, this, () => this.refreshSidebar()).open()
    });
    this.addCommand({
      id: "new-group",
      name: "New Group",
      callback: () => new GroupModal(this.app, this, () => this.refreshSidebar()).open()
    });
    this.addCommand({
      id: "new-lore",
      name: "New Lore Entry",
      callback: () => new LoreModal(this.app, this, () => this.refreshSidebar()).open()
    });
    this.addCommand({
      id: "new-timeline-event",
      name: "New Timeline Event",
      callback: () => new TimelineModal(this.app, this, () => this.refreshSidebar()).open()
    });
    this.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        let changed = false;
        for (const order of Object.values(this.settings.characterOrder)) {
          const i = order.indexOf(oldPath);
          if (i !== -1) {
            order[i] = file.path;
            changed = true;
          }
        }
        for (const order of Object.values(this.settings.sectionOrder)) {
          if (!order) continue;
          const i = order.indexOf(oldPath);
          if (i !== -1) {
            order[i] = file.path;
            changed = true;
          }
        }
        const parent = this.settings.collapsedParents.indexOf(oldPath);
        if (parent !== -1) {
          this.settings.collapsedParents[parent] = file.path;
          changed = true;
        }
        const sub = this.settings.collapsedSubsidiaries.indexOf(oldPath);
        if (sub !== -1) {
          this.settings.collapsedSubsidiaries[sub] = file.path;
          changed = true;
        }
        const b = this.settings.bookmarks.indexOf(oldPath);
        if (b !== -1) {
          this.settings.bookmarks[b] = file.path;
          changed = true;
        }
        if (changed) await this.saveSettings();
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", async (file) => {
        if (!this.settings.bookmarks.includes(file.path)) return;
        this.settings.bookmarks = this.settings.bookmarks.filter((p) => p !== file.path);
        await this.saveSettings();
      })
    );
    this.addSettingTab(new UniverseBuilderSettingTab(this.app, this));
    this.addCommand({
      id: "move-world-folder",
      name: "Move notes out of the World folder",
      callback: () => void this.checkFolderMigration(true)
    });
    this.app.workspace.onLayoutReady(() => void this.checkFolderMigration());
  }
  /**
   * Offers to move the section folders out of the legacy World folder. Runs once per plugin
   * update until settled (moved, declined, or nothing to move). `manual` (the command) ignores
   * the recorded state and always re-checks.
   */
  async checkFolderMigration(manual = false) {
    if (this.migrationBusy) return;
    const state = this.settings.folderMigration;
    const cleanupPending = !manual && state.status === "moved" && !state.legacyCleanup;
    if (!manual && !cleanupPending && (state.status || state.askedInVersion === this.manifest.version)) return;
    this.migrationBusy = true;
    try {
      if (cleanupPending) {
        await this.offerLegacyCleanup();
        return;
      }
      const current = this.settings.worldFolder.toLowerCase();
      if (current !== LEGACY_FOLDER.toLowerCase() && current !== DEFAULT_FOLDER.toLowerCase()) {
        if (manual) {
          new import_obsidian.Notice(`Universe Builder uses the custom folder "${this.settings.worldFolder}", so there's nothing to move.`);
        } else {
          state.status = "not-needed";
          await this.saveSettings();
        }
        return;
      }
      const legacy = this.findLegacyFolder();
      const sections = legacy ? this.legacySections(legacy) : [];
      if (!legacy || !sections.some((sec) => sec.label !== IMAGES_SUBFOLDER)) {
        if (manual && state.status === "moved" && legacy && !this.hasFiles(legacy)) {
          await this.offerLegacyCleanup();
          return;
        }
        if (manual) new import_obsidian.Notice(`There are no Universe Builder notes in "${LEGACY_FOLDER}/" to move.`);
        if (current === LEGACY_FOLDER.toLowerCase()) this.settings.worldFolder = DEFAULT_FOLDER;
        if (!state.status) state.status = "not-needed";
        await this.saveSettings();
        this.refreshSidebar();
        return;
      }
      const info = {
        source: legacy.path,
        sections: sections.map((s) => ({ label: s.label, count: s.files.length })),
        worldBuilder: await this.detectWorldBuilder()
      };
      const choice = await new Promise((resolve) => {
        new FolderMigrationModal(this.app, info, resolve).open();
      });
      if (choice === "move") {
        await this.moveLegacyFolder();
      } else {
        this.settings.worldFolder = legacy.path;
        if (choice === "decline") {
          state.status = "declined";
        } else {
          delete state.status;
          state.askedInVersion = this.manifest.version;
        }
        await this.saveSettings();
        this.refreshSidebar();
      }
    } catch (e) {
      console.error("Universe Builder: folder migration check failed", e);
    } finally {
      this.migrationBusy = false;
    }
  }
  /** The top-level legacy folder, matched case-insensitively (e.g. "World" or "world"). */
  findLegacyFolder() {
    for (const child of this.app.vault.getRoot().children) {
      if (child instanceof import_obsidian.TFolder && child.name.toLowerCase() === LEGACY_FOLDER.toLowerCase()) return child;
    }
    return null;
  }
  /**
   * The folders the migration moves (see migratedFolderNames) that exist inside `root` and hold
   * at least one file (any type), with those files.
   */
  legacySections(root) {
    const out = [];
    for (const label of migratedFolderNames()) {
      const folder = root.children.find(
        (c) => c instanceof import_obsidian.TFolder && c.name.toLowerCase() === label.toLowerCase()
      );
      if (!folder) continue;
      const files = [];
      import_obsidian.Vault.recurseChildren(folder, (f) => {
        if (f instanceof import_obsidian.TFile) files.push(f);
      });
      if (files.length) out.push({ label, folder, files });
    }
    return out;
  }
  /**
   * Whether the original World Builder plugin is installed, using only public API: its manifest
   * in the plugins folder means installed, its id in community-plugins.json means enabled.
   * Returns null when it isn't installed or the check fails (the prompt then just omits the warning).
   */
  async detectWorldBuilder() {
    try {
      const { adapter, configDir } = this.app.vault;
      if (!await adapter.exists(`${configDir}/plugins/${WORLD_BUILDER_ID}/manifest.json`)) return null;
      let enabled = [];
      try {
        enabled = JSON.parse(await adapter.read(`${configDir}/community-plugins.json`));
      } catch (e) {
      }
      return Array.isArray(enabled) && enabled.includes(WORLD_BUILDER_ID) ? "enabled" : "disabled";
    } catch (e) {
      return null;
    }
  }
  /**
   * Moves each migrated folder (sections and Images) from the legacy folder into DEFAULT_FOLDER. One whose
   * destination doesn't exist yet is moved as one folder; otherwise (or if that fails) it's moved
   * file by file, skipping any file that already exists at the destination. Nothing is ever
   * overwritten or deleted, apart from folders left empty by the move. Obsidian's file manager
   * does the moving, so links to the moved notes and portrait images are updated per the user's settings.
   */
  async moveLegacyFolder() {
    const state = this.settings.folderMigration;
    const legacy = this.findLegacyFolder();
    const sections = legacy ? this.legacySections(legacy) : [];
    const moved = /* @__PURE__ */ new Map();
    const skipped = [];
    const failed = [];
    const { vault, fileManager } = this.app;
    try {
      await ensureFolder(this.app, DEFAULT_FOLDER);
    } catch (e) {
      console.error(`Universe Builder: couldn't create "${DEFAULT_FOLDER}"`, e);
      new import_obsidian.Notice(`Couldn't create the "${DEFAULT_FOLDER}" folder, so nothing was moved.`);
      return;
    }
    for (const { label, folder, files } of sections) {
      const dest = `${DEFAULT_FOLDER}/${label}`;
      const srcPrefix = folder.path;
      const targetOf = (f) => dest + f.path.slice(srcPrefix.length);
      if (!vault.getAbstractFileByPath(dest)) {
        const plan = files.map((f) => [f.path, targetOf(f)]);
        try {
          await fileManager.renameFile(folder, dest);
          for (const [from, to] of plan) moved.set(from, to);
          continue;
        } catch (e) {
          console.warn(`Universe Builder: moving "${srcPrefix}" as a folder failed, moving file by file`, e);
        }
      }
      for (const file of files) {
        const target = targetOf(file);
        if (vault.getAbstractFileByPath(target)) {
          skipped.push(file.path);
          continue;
        }
        const from = file.path;
        try {
          await ensureFolder(this.app, target.slice(0, target.lastIndexOf("/")));
          await fileManager.renameFile(file, target);
          moved.set(from, target);
        } catch (e) {
          console.error(`Universe Builder: couldn't move "${from}"`, e);
          failed.push(from);
        }
      }
      await this.removeEmptyFolders(folder);
    }
    const leftovers = legacy && this.hasFiles(legacy) ? legacy.children.map((c) => c.name) : [];
    this.remapPaths(moved);
    if (moved.size || !failed.length) this.settings.worldFolder = DEFAULT_FOLDER;
    if (failed.length) {
      delete state.status;
      delete state.askedInVersion;
    } else {
      state.status = "moved";
      delete state.askedInVersion;
    }
    await this.saveSettings();
    this.refreshSidebar();
    const lines = [`Moved ${moved.size} file${moved.size === 1 ? "" : "s"} to "${DEFAULT_FOLDER}/".`];
    if (skipped.length) {
      lines.push(`${skipped.length} skipped because a file with the same name was already there: ${skipped.join(", ")}.`);
    }
    if (failed.length) {
      lines.push(`${failed.length} couldn't be moved (see the developer console); you'll be asked again next launch: ${failed.join(", ")}.`);
    }
    if (leftovers.length && legacy) lines.push(`Left in "${legacy.path}/": ${leftovers.join(", ")}.`);
    new import_obsidian.Notice(lines.join("\n"), skipped.length || failed.length ? 0 : 8e3);
    if (!failed.length) await this.offerLegacyCleanup();
  }
  /** True when `folder` or any folder inside it holds at least one file. */
  hasFiles(folder) {
    let found = false;
    import_obsidian.Vault.recurseChildren(folder, (f) => {
      if (f instanceof import_obsidian.TFile) found = true;
    });
    return found;
  }
  /**
   * After a move, offers to delete the legacy World folder when it holds no files (empty
   * subfolders don't count), since nothing uses it any more. A vault shared with the original
   * World Builder keeps its World/Factions notes, so it never qualifies. "Delete" sends the
   * folder to the trash per Obsidian's "Deleted files" setting. The answer is recorded;
   * closing the dialog leaves it unanswered, so it's offered again on the next launch.
   */
  async offerLegacyCleanup() {
    const legacy = this.findLegacyFolder();
    if (!legacy || this.hasFiles(legacy)) return;
    const emptyFolders = [];
    import_obsidian.Vault.recurseChildren(legacy, (f) => {
      if (f instanceof import_obsidian.TFolder && f !== legacy) emptyFolders.push(f.path.slice(legacy.path.length + 1));
    });
    const choice = await new Promise((resolve) => {
      new LegacyCleanupModal(this.app, legacy.path, emptyFolders, resolve).open();
    });
    if (!choice) return;
    const state = this.settings.folderMigration;
    if (choice === "keep") {
      state.legacyCleanup = "kept";
    } else {
      const current = this.findLegacyFolder();
      if (current && this.hasFiles(current)) {
        new import_obsidian.Notice(`"${current.path}/" has files in it again, so it wasn't deleted.`);
        return;
      }
      try {
        if (current) await this.app.fileManager.trashFile(current);
        state.legacyCleanup = "deleted";
        new import_obsidian.Notice(`Deleted the empty "${legacy.path}/" folder.`);
      } catch (e) {
        console.error(`Universe Builder: couldn't delete "${legacy.path}"`, e);
        new import_obsidian.Notice(`Couldn't delete "${legacy.path}/" (see the developer console).`);
        return;
      }
    }
    await this.saveSettings();
  }
  /** Deletes `folder` and any subfolders that hold no files, deepest first. */
  async removeEmptyFolders(folder) {
    for (const child of [...folder.children]) {
      if (child instanceof import_obsidian.TFolder) await this.removeEmptyFolders(child);
    }
    if (folder.children.length === 0) {
      try {
        await this.app.fileManager.trashFile(folder);
      } catch (e) {
        console.warn(`Universe Builder: couldn't remove the empty "${folder.path}" folder`, e);
      }
    }
  }
  /** Points every note path stored in settings at its new location after a move. */
  remapPaths(moved) {
    if (!moved.size) return;
    const remap = (paths) => paths.map((p) => {
      var _a;
      return (_a = moved.get(p)) != null ? _a : p;
    });
    const s = this.settings;
    for (const key of Object.keys(s.characterOrder)) s.characterOrder[key] = remap(s.characterOrder[key]);
    for (const tab of Object.keys(s.sectionOrder)) {
      const order = s.sectionOrder[tab];
      if (order) s.sectionOrder[tab] = remap(order);
    }
    s.collapsedParents = remap(s.collapsedParents);
    s.collapsedSubsidiaries = remap(s.collapsedSubsidiaries);
    s.bookmarks = remap(s.bookmarks);
  }
  async activateSidebar() {
    var _a;
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = (_a = workspace.getRightLeaf(false)) != null ? _a : workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }
  refreshSidebar() {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if ((leaf == null ? void 0 : leaf.view) instanceof UniverseBuilderView) {
      void leaf.view.render();
    }
  }
  async loadSettings() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    this.settings.characterOrder = (_a = data == null ? void 0 : data.characterOrder) != null ? _a : {};
    this.settings.collapsedGroups = (_b = data == null ? void 0 : data.collapsedGroups) != null ? _b : [];
    this.settings.collapsedGroupTypes = (_c = data == null ? void 0 : data.collapsedGroupTypes) != null ? _c : [];
    this.settings.collapsedParents = (_d = data == null ? void 0 : data.collapsedParents) != null ? _d : [];
    this.settings.collapsedSubsidiaries = (_e = data == null ? void 0 : data.collapsedSubsidiaries) != null ? _e : [];
    this.settings.sectionOrder = (_f = data == null ? void 0 : data.sectionOrder) != null ? _f : {};
    this.settings.bookmarks = (_g = data == null ? void 0 : data.bookmarks) != null ? _g : [];
    this.settings.collapsedBookmarkGroups = (_h = data == null ? void 0 : data.collapsedBookmarkGroups) != null ? _h : [];
    this.settings.folderMigration = { ...(_i = data == null ? void 0 : data.folderMigration) != null ? _i : {} };
    this.migrateLegacySettings(data);
    this.settings.inlineEditor = (data == null ? void 0 : data.inlineEditor) === "raw" ? "raw" : "live";
  }
  /**
   * Carries over plugin data saved before the "Employers" tab was renamed to "Groups", so
   * collapsed sections and custom ordering survive the rename. The old keys are dropped on the
   * next save.
   */
  migrateLegacySettings(data) {
    if (!data) return;
    const legacy = this.settings;
    if (!data.collapsedGroups && data.collapsedEmployers) this.settings.collapsedGroups = data.collapsedEmployers;
    if (!data.collapsedGroupTypes && data.collapsedEmployerTypes) this.settings.collapsedGroupTypes = data.collapsedEmployerTypes;
    delete legacy.collapsedEmployers;
    delete legacy.collapsedEmployerTypes;
    const order = this.settings.sectionOrder;
    if (order.employers && !order.groups) order.groups = order.employers;
    delete order.employers;
    this.settings.collapsedBookmarkGroups = this.settings.collapsedBookmarkGroups.map((k) => k === "employers" ? "groups" : k);
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
