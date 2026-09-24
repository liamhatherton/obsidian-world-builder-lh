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
  default: () => WorldBuilderPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  worldFolder: "World",
  characterOrder: {},
  collapsedGroups: [],
  collapsedGroupTypes: [],
  collapsedParents: [],
  collapsedSubsidiaries: [],
  sectionOrder: {},
  bookmarks: [],
  collapsedBookmarkGroups: [],
  inlineEditor: "live"
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
function stripGraphics(markdown) {
  return markdown.replace(/!\[\[([^\]]+)\]\]/g, (match, inner) => {
    const target = inner.split("|")[0].split("#")[0].trim();
    return IMG_EXT.test(target) ? "" : match;
  }).replace(/!\[[^\]]*\]\((?:<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g, "").replace(/<img\b[^>]*\/?>/gi, "");
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
var VIEW_TYPE = "world-builder-sidebar";
var WorldBuilderView = class extends import_obsidian.ItemView {
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
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "World Builder";
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
    this.navButtons = [];
    this.bookmarkHeaderButtons = [];
    this.sectionConfigs = {};
    const fixed = containerEl.createDiv("wb-fixed");
    const scroll = containerEl.createDiv("wb-scroll");
    const header = fixed.createDiv("wb-header");
    header.createEl("h2", { text: "Hatherton's World Builder" });
    const bookmarksBtn = header.createEl("button", {
      cls: "wb-btn-secondary wb-icon-btn wb-bookmarks-btn",
      attr: { type: "button", "aria-label": "Bookmarks" }
    });
    (0, import_obsidian.setIcon)(bookmarksBtn, "bookmark");
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
    (0, import_obsidian.setIcon)(searchBox.createEl("span", { cls: "wb-search-icon" }), "search");
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
      () => new CharacterModal(this.app, this.plugin, () => this.render()).open(),
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
      () => new LocationModal(this.app, this.plugin, () => this.render()).open(),
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
      () => new GroupModal(this.app, this.plugin, () => this.render()).open(),
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
      () => new LoreModal(this.app, this.plugin, () => this.render()).open(),
      (fm) => {
        var _a2, _b2, _c2;
        return {
          title: (_a2 = fm.title) != null ? _a2 : "Untitled",
          meta: (_b2 = fm.category) != null ? _b2 : "",
          badge: (_c2 = fm.category) != null ? _c2 : ""
        };
      },
      { expandable: true }
    );
    await this.renderSection(
      "timeline",
      contents.timeline,
      `${folder}/Timeline`,
      "Timeline Events",
      () => new TimelineModal(this.app, this.plugin, () => this.render()).open(),
      (fm) => {
        var _a2, _b2;
        return {
          title: (_a2 = fm.title) != null ? _a2 : "Untitled",
          meta: (_b2 = fm.date) != null ? _b2 : "",
          badge: ""
        };
      },
      { expandable: true }
    );
    this.renderSectionHeader(bookmarksPane, "Bookmarks", null, true);
    this.renderBookmarks();
    if (reopen.length) {
      this.restoringNav = true;
      try {
        for (const { tab, path } of reopen) {
          const card = (_d = contents[tab]) == null ? void 0 : _d.body.querySelector(`.wb-card[data-path="${CSS.escape(path)}"]`);
          const entry = this.entryByPath.get(path);
          if (card && entry && !card.classList.contains("wb-card-expanded")) this.toggleCardExpand(tab, card, entry);
        }
      } finally {
        this.restoringNav = false;
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
    const re = /!\[\[([^\]]+)\]\]|!\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      let target;
      if (m[1] !== void 0) {
        target = m[1].split("|")[0].split("#")[0].trim();
      } else {
        target = ((_a = m[2]) != null ? _a : "").trim();
        if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
        if (/^https?:\/\//i.test(target)) {
          if (IMG_EXT.test(target.split(/[?#]/)[0])) return target;
          continue;
        }
        try {
          target = decodeURIComponent(target);
        } catch (e) {
        }
        target = target.split("#")[0];
      }
      if (!IMG_EXT.test(target)) continue;
      const dest = (_b = this.app.metadataCache.getFirstLinkpathDest(target, file.path)) != null ? _b : this.app.vault.getAbstractFileByPath(target);
      if (dest instanceof import_obsidian.TFile) return this.app.vault.getResourcePath(dest);
    }
    return null;
  }
  async renderSection(tab, pane, folderPath, label, onCreate, getCard, opts = {}) {
    var _a, _b, _c, _d, _e, _f, _g;
    const container = pane.body;
    this.sectionConfigs[tab] = { getCard, thumbs: !!opts.thumbs, stackBadge: !!opts.stackBadge };
    this.renderSectionHeader(pane, label, onCreate, (_a = opts.reload) != null ? _a : true);
    const files = this.app.vault.getMarkdownFiles().filter(
      (f) => f.path.startsWith(folderPath + "/")
    );
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
    const groupFolder = `${this.plugin.settings.worldFolder}/Groups/`;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(groupFolder)) continue;
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
      (0, import_obsidian.setIcon)(header.createEl("span", { cls: "wb-group-chevron" }), "chevron-down");
      const logoSrc = key ? groupLogos.get(parseRefName(key).toLowerCase()) : void 0;
      if (logoSrc) {
        const logo = header.createEl("img", {
          cls: "wb-group-logo",
          attr: { src: logoSrc, alt: "", draggable: "false" }
        });
        logo.onerror = () => logo.remove();
      }
      header.createEl("span", { cls: "wb-group-title", text: group.label });
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
      header.onclick = toggleCollapsed;
      header.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleCollapsed();
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
   * A tab's section header (fixed region): Back/Forward and the label on the left; Reload and
   * (for the entry sections) + New on the right. (The Bookmarks button lives in the title row.)
   */
  renderSectionHeader(pane, label, onCreate, reload) {
    const hdr = pane.head.createDiv("wb-section-header");
    const titleGroup = hdr.createDiv("wb-section-title");
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
    titleGroup.createEl("span", { text: label });
    const actions = hdr.createDiv("wb-section-actions");
    if (reload) {
      const reloadBtn = actions.createEl("button", { cls: "wb-btn-secondary" });
      (0, import_obsidian.setIcon)(reloadBtn.createEl("span", { cls: "wb-btn-icon" }), "refresh-cw");
      reloadBtn.createEl("span", { text: "Reload" });
      reloadBtn.onclick = async () => {
        await this.render();
        new import_obsidian.Notice("World Builder reloaded.");
      };
    }
    if (onCreate) {
      const btn = actions.createEl("button", { text: "+ New", cls: "wb-btn-primary" });
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
      (0, import_obsidian.setIcon)(header.createEl("span", { cls: "wb-group-chevron" }), "chevron-down");
      header.createEl("span", { cls: "wb-group-title", text: label });
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
      header.onclick = toggleCollapsed;
      header.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleCollapsed();
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
    (0, import_obsidian.setIcon)(header.createEl("span", { cls: "wb-group-chevron" }), "chevron-down");
    header.createEl("span", { cls: "wb-group-title", text: "Subsidiaries" });
    header.createEl("span", { cls: "wb-group-count", text: String(kids.length) });
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
    header.onclick = toggleCollapsed;
    header.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleCollapsed();
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
    (0, import_obsidian.setIcon)(header.createEl("span", { cls: "wb-group-chevron" }), "chevron-down");
    header.createEl("span", { cls: "wb-group-title", text: title });
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
      setCollapsed(!header.classList.contains("is-collapsed"));
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
   * Expands a card in place to show the note's text (no images) instead of opening it in the
   * editor, so writing in the main pane isn't interrupted. Modify MD in the expanded area opens
   * the note the normal way; Edit edits its markdown inline. Clicking the card again (or its chevron) collapses it.
   */
  toggleCardExpand(tab, card, entry, force = false) {
    var _a, _b;
    const wasExpanded = card.classList.contains("wb-card-expanded");
    const editingThis = ((_a = this.activeEdit) == null ? void 0 : _a.card) === card;
    if (wasExpanded && !force && editingThis && this.activeEdit.isDirty()) {
      void confirmModal(this.app, "Discard changes?", `Your edits to "${entry.file.basename}" haven't been saved.`, "Discard").then((ok) => {
        if (ok) this.toggleCardExpand(tab, card, entry, true);
      });
      return;
    }
    if (editingThis) {
      this.activeEdit.abandon();
      this.activeEdit = null;
    }
    (_b = card.querySelector(":scope > .wb-card-expand")) == null ? void 0 : _b.remove();
    card.removeClass("wb-card-expanded");
    card.setAttribute("aria-expanded", "false");
    if (wasExpanded) {
      this.recordNav(tab, null);
      return;
    }
    card.addClass("wb-card-expanded");
    card.setAttribute("aria-expanded", "true");
    const expand = card.createDiv("wb-card-expand");
    expand.setAttribute("draggable", "false");
    expand.onclick = (e) => e.stopPropagation();
    expand.onkeydown = (e) => e.stopPropagation();
    const body = expand.createDiv("wb-card-expand-body");
    body.addClass("markdown-rendered");
    const bodyText = stripLeadingHeading(stripFrontmatterBlock(entry.content));
    const textOnly = stripGraphics(bodyText);
    import_obsidian.MarkdownRenderer.render(this.app, textOnly, body, entry.file.path, this);
    body.addEventListener("click", (e) => {
      var _a2;
      const target = e.target;
      const link = target.closest("a.internal-link");
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      const href = (_a2 = link.getAttribute("data-href")) != null ? _a2 : link.getAttribute("href");
      if (href) this.followWikiLink(href, entry.file.path);
    });
    const footer = expand.createDiv("wb-card-expand-footer");
    const bookmarkBtn = footer.createEl("button", {
      cls: "wb-btn-secondary wb-icon-btn wb-bookmark-toggle",
      attr: { type: "button", "data-bookmark-path": entry.file.path }
    });
    (0, import_obsidian.setIcon)(bookmarkBtn, "bookmark");
    this.syncBookmarkToggle(bookmarkBtn, this.plugin.settings.bookmarks.includes(entry.file.path));
    bookmarkBtn.onclick = () => this.toggleBookmark(entry.file.path);
    const actions = footer.createDiv("wb-card-expand-actions");
    const showViewActions = () => {
      actions.empty();
      const modifyBtn = actions.createEl("button", { cls: "wb-btn-secondary", attr: { type: "button" } });
      (0, import_obsidian.setIcon)(modifyBtn.createEl("span", { cls: "wb-btn-icon" }), "file-text");
      modifyBtn.createEl("span", { text: "Modify MD" });
      modifyBtn.onclick = () => this.app.workspace.getLeaf().openFile(entry.file);
      const editBtn = actions.createEl("button", { cls: "wb-btn-secondary", attr: { type: "button" } });
      (0, import_obsidian.setIcon)(editBtn.createEl("span", { cls: "wb-btn-icon" }), "pencil");
      editBtn.createEl("span", { text: "Edit" });
      editBtn.onclick = () => void runExclusive(startEditing);
    };
    const showEditActions = () => {
      actions.empty();
      const cancelBtn = actions.createEl("button", { cls: "wb-btn-secondary", attr: { type: "button" } });
      (0, import_obsidian.setIcon)(cancelBtn.createEl("span", { cls: "wb-btn-icon" }), "x");
      cancelBtn.createEl("span", { text: "Cancel" });
      cancelBtn.onclick = () => void runExclusive(discard);
      const saveBtn = actions.createEl("button", { cls: "wb-btn-primary", attr: { type: "button" } });
      (0, import_obsidian.setIcon)(saveBtn.createEl("span", { cls: "wb-btn-icon" }), "check");
      saveBtn.createEl("span", { text: "Save" });
      saveBtn.onclick = () => void runExclusive(finishEditing);
    };
    let editor = null;
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
    const isDirty = () => !!editor && editor.isDirty();
    const stopEditing = () => {
      var _a2;
      if (((_a2 = this.activeEdit) == null ? void 0 : _a2.card) === card) this.activeEdit = null;
      editor == null ? void 0 : editor.destroy();
      editor = null;
      body.show();
      expand.removeClass("is-editing");
      showViewActions();
    };
    const startEditing = async () => {
      var _a2;
      const other = this.activeEdit;
      if (other && other.card !== card) {
        this.pendingEditPath = entry.file.path;
        const ok = await other.finish();
        if (!ok || !card.isConnected) {
          if (!ok) this.pendingEditPath = null;
          return;
        }
        this.pendingEditPath = null;
      }
      try {
        original = await this.app.vault.read(entry.file);
      } catch (err) {
        new import_obsidian.Notice(`Couldn't read "${entry.file.basename}".`);
        return;
      }
      if (!card.isConnected || !expand.isConnected || editor) return;
      expand.addClass("is-editing");
      showEditActions();
      body.hide();
      const keys = {
        save: () => void runExclusive(finishEditing),
        cancel: () => void runExclusive(discard)
      };
      editor = (_a2 = this.plugin.settings.inlineEditor === "live" ? createLivePreviewEditor(this.app, this, body, entry.file, original, keys) : null) != null ? _a2 : createRawEditor(body, entry.file, original, keys);
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
        await this.app.vault.modify(entry.file, editor.getText());
        if (((_a2 = this.activeEdit) == null ? void 0 : _a2.card) === card) this.activeEdit = null;
        editor.destroy();
        editor = null;
        await this.render({ keepExpanded: true });
        new import_obsidian.Notice(`Saved "${entry.file.basename}".`);
      } catch (err) {
        console.error("World Builder: save failed", err);
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
      var _a2, _b;
      if (((_a2 = this.activeEdit) == null ? void 0 : _a2.card) === card) {
        if (this.activeEdit.isDirty()) return;
        this.activeEdit.abandon();
        this.activeEdit = null;
      }
      (_b = card.querySelector(":scope > .wb-card-expand")) == null ? void 0 : _b.remove();
      card.removeClass("wb-card-expanded");
      card.setAttribute("aria-expanded", "false");
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
  /** The section folder a tab's notes live in, e.g. "World/Characters". */
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
    var _a, _b, _c, _d, _e, _f, _g;
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
    (_f = this.showTabSearchFn) == null ? void 0 : _f.call(this);
    (_g = this.updateShadowFn) == null ? void 0 : _g.call(this);
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
      (0, import_obsidian.setIcon)(header.createEl("span", { cls: "wb-group-chevron" }), "chevron-down");
      header.createEl("span", { cls: "wb-group-title", text: SECTION_LABELS[section] });
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
      header.onclick = toggleCollapsed;
      header.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleCollapsed();
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
      try {
        container.querySelectorAll(".wb-card").forEach((card) => {
          var _a2;
          const path = (_a2 = card.getAttribute("data-path")) != null ? _a2 : "";
          const entry = this.entryByPath.get(path);
          if (entry && wasExpanded.has(path)) this.toggleCardExpand(tab, card, entry);
        });
      } finally {
        this.restoringNav = false;
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
    this.refreshCurrentCardHighlight();
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
    this.restoringNav = true;
    try {
      this.switchTab(entry.tab);
      if (entry.cardPath) this.revealCard(entry.tab, entry.cardPath);
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
      this.app.workspace.getLeaf().openFile(dest);
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
      const entry = this.entryByPath.get(path);
      if (entry) this.toggleCardExpand(tab, card, entry);
    }
    card.scrollIntoView({ block: "center", behavior: "smooth" });
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
    list.addEventListener("drop", async (e) => {
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
    });
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
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight + 2}px`;
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
  requestAnimationFrame(autosize);
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
  var _a, _b, _c, _d;
  if (livePreviewEditorClass !== void 0) return livePreviewEditorClass;
  livePreviewEditorClass = null;
  try {
    const embed = (_c = (_b = (_a = app.embedRegistry) == null ? void 0 : _a.embedByExtension) == null ? void 0 : _b.md) == null ? void 0 : _c.call(_b, { app, containerEl: createDiv(), state: {} }, null, "");
    if (embed) {
      embed.load();
      embed.editable = true;
      embed.showEditor();
      const ctor = embed.editMode ? (_d = Object.getPrototypeOf(Object.getPrototypeOf(embed.editMode))) == null ? void 0 : _d.constructor : null;
      embed.unload();
      if (typeof ctor === "function") livePreviewEditorClass = ctor;
    }
  } catch (err) {
    console.warn("World Builder: Live Preview editor unavailable (Obsidian internals changed?); using the raw markdown editor.", err);
  }
  return livePreviewEditorClass;
}
function createLivePreviewEditor(app, parent, anchor, file, text, keys) {
  const Base = resolveLivePreviewEditorClass(app);
  if (!Base) return null;
  const wrap = createDiv("wb-card-editor-wrap wb-card-editor-live");
  anchor.insertAdjacentElement("afterend", wrap);
  const fm = splitFrontmatter(text);
  let props = null;
  if (fm) {
    wrap.createDiv({ cls: "wb-card-editor-label", text: "Properties" });
    props = createAutoTextarea(wrap, "wb-card-editor wb-card-editor-props", fm.yaml, `Properties of ${file.basename}`, keys);
  }
  const host = wrap.createDiv("wb-card-editor-body");
  const baseSize = parseFloat(getComputedStyle(host).getPropertyValue("--font-text-size")) || 16;
  host.style.setProperty("--font-text-size", `${baseSize * LIVE_PREVIEW_TEXT_SCALE}px`);
  let cmp = null;
  const owner = {
    app,
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
        return new Proxy((_a = target.config) != null ? _a : {}, {
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
  const bodyText = fm ? fm.body : text;
  let initialBody = bodyText;
  try {
    class SidebarMarkdownEditor extends Base {
      // The stock editor pads the bottom so the last line can scroll to mid-screen; not wanted in a card.
      updateBottomPadding() {
      }
    }
    cmp = new SidebarMarkdownEditor(appProxy, host, owner);
    parent.addChild(cmp);
    owner.editMode = cmp;
    cmp.set(bodyText);
    initialBody = getBodyValue();
  } catch (err) {
    console.warn("World Builder: couldn't create the Live Preview editor; using the raw markdown editor.", err);
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
      const newBody = bodyChanged() ? getBodyValue() : bodyText;
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
        parent.removeChild(cmp);
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
var CharacterModal = class extends import_obsidian.Modal {
  constructor(app, plugin, onDone) {
    super(app);
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
    new import_obsidian.Setting(contentEl).setName("Name").addText((t) => {
      t.setPlaceholder("Character name").onChange((v) => this.data.name = v);
    });
    new import_obsidian.Setting(contentEl).setName("Role").addDropdown((d) => {
      ["protagonist", "antagonist", "supporting", "minor"].forEach(
        (o) => d.addOption(o, o.charAt(0).toUpperCase() + o.slice(1))
      );
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
      (b) => b.setButtonText("Create").setCta().onClick(() => this.submit())
    );
  }
  async submit() {
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
    const headingColor = "#fac08f";
    const sectionLines = [];
    for (const [heading, text] of sections) {
      sectionLines.push(`## <font color="${headingColor}">${heading}</font>`);
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
    new import_obsidian.Notice(`Character "${this.data.name}" created.`);
    this.close();
    this.onDone();
    await this.app.workspace.getLeaf().openFile(file);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var LocationModal = class extends import_obsidian.Modal {
  constructor(app, plugin, onDone) {
    super(app);
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
    new import_obsidian.Setting(contentEl).setName("Name").addText((t) => {
      t.setPlaceholder("Location name").onChange((v) => this.data.name = v);
    });
    new import_obsidian.Setting(contentEl).setName("Type").addDropdown((d) => {
      ["planet", "dwarf planet", "moon", "station", "asteroid", "belt", "ship", "city", "region", "building", "landmark", "other"].forEach(
        (o) => d.addOption(o, o.charAt(0).toUpperCase() + o.slice(1))
      );
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
      (b) => b.setButtonText("Create").setCta().onClick(() => this.submit())
    );
  }
  async submit() {
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
    new import_obsidian.Notice(`Location "${this.data.name}" created.`);
    this.close();
    this.onDone();
    await this.app.workspace.getLeaf().openFile(file);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var GroupModal = class extends import_obsidian.Modal {
  constructor(app, plugin, onDone) {
    super(app);
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
    new import_obsidian.Setting(contentEl).setName("Name").addText((t) => {
      t.setPlaceholder("Group name").onChange((v) => this.data.name = v);
    });
    new import_obsidian.Setting(contentEl).setName("Type").addDropdown((d) => {
      GROUP_TYPES.forEach(({ key, label }) => d.addOption(key, label));
      d.setValue(this.data.type);
      d.onChange((v) => this.data.type = v);
    });
    const folder = `${this.plugin.settings.worldFolder}/Groups/`;
    const existing = Array.from(new Set(
      this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder)).map((f) => {
        var _a, _b;
        const name = (_b = (_a = this.app.metadataCache.getFileCache(f)) == null ? void 0 : _a.frontmatter) == null ? void 0 : _b.name;
        return typeof name === "string" && name.trim() ? name.trim() : f.basename;
      })
    )).sort((a, b) => a.localeCompare(b));
    new import_obsidian.Setting(contentEl).setName("Subsidiary of").setDesc("Nests this group under its parent's Subsidiaries label instead of its Type section.").addDropdown((d) => {
      d.addOption("", "None");
      existing.forEach((n) => d.addOption(n, n));
      d.setValue(this.data.subsidiaryOf);
      d.onChange((v) => this.data.subsidiaryOf = v);
    });
    new import_obsidian.Setting(contentEl).setName("Alignment").addDropdown((d) => {
      ["lawful", "neutral", "chaotic"].forEach(
        (o) => d.addOption(o, o.charAt(0).toUpperCase() + o.slice(1))
      );
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
      (b) => b.setButtonText("Create").setCta().onClick(() => this.submit())
    );
  }
  async submit() {
    var _a, _b;
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
    new import_obsidian.Notice(`Group "${this.data.name}" created.`);
    this.close();
    this.onDone();
    await this.app.workspace.getLeaf().openFile(file);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var LoreModal = class extends import_obsidian.Modal {
  constructor(app, plugin, onDone) {
    super(app);
    this.data = { title: "", category: "history", content: "" };
    this.plugin = plugin;
    this.onDone = onDone;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("wb-modal");
    contentEl.createEl("h2", { text: "New Lore Entry" });
    new import_obsidian.Setting(contentEl).setName("Title").addText((t) => {
      t.setPlaceholder("Entry title").onChange((v) => this.data.title = v);
    });
    new import_obsidian.Setting(contentEl).setName("Category").addDropdown((d) => {
      ["history", "tech", "religion", "culture", "other"].forEach(
        (o) => d.addOption(o, o.charAt(0).toUpperCase() + o.slice(1))
      );
      d.setValue(this.data.category);
      d.onChange((v) => this.data.category = v);
    });
    new import_obsidian.Setting(contentEl).setName("Content").addTextArea((t) => {
      t.inputEl.addClass("wb-textarea");
      t.inputEl.style.minHeight = "120px";
      t.onChange((v) => this.data.content = v);
    });
    new import_obsidian.Setting(contentEl).addButton(
      (b) => b.setButtonText("Create").setCta().onClick(() => this.submit())
    );
  }
  async submit() {
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
    new import_obsidian.Notice(`Lore entry "${this.data.title}" created.`);
    this.close();
    this.onDone();
    await this.app.workspace.getLeaf().openFile(file);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var TimelineModal = class extends import_obsidian.Modal {
  constructor(app, plugin, onDone) {
    super(app);
    this.data = { date: "", title: "", description: "", characters: "", locations: "" };
    this.plugin = plugin;
    this.onDone = onDone;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("wb-modal");
    contentEl.createEl("h2", { text: "New Timeline Event" });
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
      (b) => b.setButtonText("Create").setCta().onClick(() => this.submit())
    );
  }
  async submit() {
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
    new import_obsidian.Notice(`Timeline event "${this.data.title}" created.`);
    this.close();
    this.onDone();
    await this.app.workspace.getLeaf().openFile(file);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var WorldBuilderSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "World Builder Settings" });
    new import_obsidian.Setting(containerEl).setName("World Folder").setDesc("Root folder for all world-building notes.").addText(
      (t) => t.setPlaceholder("World").setValue(this.plugin.settings.worldFolder).onChange(async (v) => {
        this.plugin.settings.worldFolder = v || "World";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Sidebar editor").setDesc(
      "What the Edit button on an expanded entry opens. Live Preview uses Obsidian's own editor (formatting shown as you type, [[link]] suggestions); Raw markdown is a plain text box. If Live Preview ever stops working after an Obsidian update, the plugin falls back to Raw markdown on its own."
    ).addDropdown(
      (d) => d.addOption("live", "Live Preview").addOption("raw", "Raw markdown").setValue(this.plugin.settings.inlineEditor).onChange(async (v) => {
        this.plugin.settings.inlineEditor = v === "raw" ? "raw" : "live";
        await this.plugin.saveSettings();
      })
    );
  }
};
var WorldBuilderPlugin = class extends import_obsidian.Plugin {
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new WorldBuilderView(leaf, this));
    this.addRibbonIcon("orbit", "World Builder", () => this.activateSidebar());
    this.addCommand({
      id: "open-sidebar",
      name: "Open World Builder sidebar",
      callback: () => this.activateSidebar()
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
    this.addSettingTab(new WorldBuilderSettingTab(this.app, this));
  }
  async activateSidebar() {
    var _a;
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = (_a = workspace.getRightLeaf(false)) != null ? _a : workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }
  refreshSidebar() {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if ((leaf == null ? void 0 : leaf.view) instanceof WorldBuilderView) {
      leaf.view.render();
    }
  }
  async loadSettings() {
    var _a, _b, _c, _d, _e, _f, _g, _h;
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
