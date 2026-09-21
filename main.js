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
var DEFAULT_SETTINGS = { worldFolder: "World", characterOrder: {}, collapsedEmployers: [] };
function slugify(s) {
  return s.replace(/[/\\:*?"<>|#^[\]]/g, "-").trim();
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
function documentSearchText(content, fm) {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "").replace(/!\[\[[^\]]*\]\]/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1").replace(/\[\[([^\]]*)\]\]/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, " ");
  const values = Object.entries(fm).filter(([key]) => key !== "entry_type").map(([, value]) => value);
  return [...values, body].join(" ");
}
var SEARCH_HINTS = {
  characters: { noun: "characters", tip: "Matches name, employer, ship and home" },
  locations: { noun: "locations", tip: "Matches the name and the text of the note" },
  employers: { noun: "employers", tip: "Matches the name and the text of the note" },
  lore: { noun: "lore", tip: "Matches the title and the text of the note" },
  timeline: { noun: "timeline", tip: "Matches the title and the text of the note" }
};
var VIEW_TYPE = "world-builder-sidebar";
var WorldBuilderView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.activeTab = "characters";
    /** What is typed in the search bar for each tab; kept here so it survives a redraw (Reload, new note, ...). */
    this.searchQueries = { characters: "", locations: "", employers: "", lore: "", timeline: "" };
    this.searchTargets = {};
    /** Normalised text each card is matched against. */
    this.searchIndex = /* @__PURE__ */ new WeakMap();
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "World Builder";
  }
  getIcon() {
    return "globe";
  }
  async onOpen() {
    await this.render();
  }
  async onClose() {
  }
  async render() {
    var _a, _b;
    const { containerEl } = this;
    const scrollTop = (_b = (_a = containerEl.querySelector(".wb-scroll")) == null ? void 0 : _a.scrollTop) != null ? _b : 0;
    const oldSearch = containerEl.querySelector(".wb-search-input");
    const searchHadFocus = !!oldSearch && containerEl.ownerDocument.activeElement === oldSearch;
    containerEl.empty();
    containerEl.addClass("wb-sidebar");
    const fixed = containerEl.createDiv("wb-fixed");
    const scroll = containerEl.createDiv("wb-scroll");
    const header = fixed.createDiv("wb-header");
    header.createEl("h2", { text: "Hatherton World Builder" });
    const tabBar = fixed.createDiv("wb-tabs");
    const tabs = [
      { id: "characters", label: "Characters" },
      { id: "locations", label: "Locations" },
      { id: "employers", label: "Employers" },
      { id: "lore", label: "Lore" },
      { id: "timeline", label: "Timeline" }
    ];
    const contents = {};
    tabs.forEach(({ id, label }) => {
      const btn = tabBar.createEl("button", { text: label, cls: "wb-tab" });
      if (id === this.activeTab) btn.addClass("active");
      btn.onclick = () => {
        var _a2, _b2;
        this.activeTab = id;
        tabBar.querySelectorAll(".wb-tab").forEach((b) => b.removeClass("active"));
        btn.addClass("active");
        Object.values(contents).forEach((c) => {
          c == null ? void 0 : c.head.removeClass("active");
          c == null ? void 0 : c.body.removeClass("active");
        });
        (_a2 = contents[id]) == null ? void 0 : _a2.head.addClass("active");
        (_b2 = contents[id]) == null ? void 0 : _b2.body.addClass("active");
        showTabSearch();
        updateShadow();
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
      contents.characters,
      `${folder}/Characters`,
      "Characters",
      () => new CharacterModal(this.app, this.plugin, () => this.render()).open(),
      (fm) => {
        var _a2, _b2;
        return {
          title: (_a2 = fm.name) != null ? _a2 : "Unnamed",
          // Two lines: age/home, then employer/ship (a line with no values is dropped).
          meta: [
            labeledLine([["Age", fm.age], ["Home", fm.home]]),
            labeledLine([["Employer", fm.employer], ["Ship", fm.ship]])
          ].filter(Boolean).join("\n"),
          badge: (_b2 = fm.role) != null ? _b2 : "",
          // What the search bar matches against.
          search: [fm.name, fm.employer, fm.ship, fm.home].filter(Boolean).join(" ")
        };
      },
      { thumbs: true, employerGroups: true, stackBadge: true }
    );
    await this.renderSection(
      contents.locations,
      `${folder}/Locations`,
      "Locations",
      () => new LocationModal(this.app, this.plugin, () => this.render()).open(),
      (fm) => {
        var _a2, _b2, _c;
        return {
          title: (_a2 = fm.name) != null ? _a2 : "Unnamed",
          meta: `${(_b2 = fm.type) != null ? _b2 : ""} ${fm.parent ? `\xB7 in ${fm.parent}` : ""}`.trim(),
          badge: (_c = fm.type) != null ? _c : ""
        };
      }
    );
    await this.renderSection(
      contents.employers,
      `${folder}/Employers`,
      "Employers",
      () => new EmployerModal(this.app, this.plugin, () => this.render()).open(),
      (fm) => {
        var _a2, _b2, _c;
        return {
          title: (_a2 = fm.name) != null ? _a2 : "Unnamed",
          meta: (_b2 = fm.goals) != null ? _b2 : "",
          badge: (_c = fm.alignment) != null ? _c : ""
        };
      }
    );
    await this.renderSection(
      contents.lore,
      `${folder}/Lore`,
      "Lore Entries",
      () => new LoreModal(this.app, this.plugin, () => this.render()).open(),
      (fm) => {
        var _a2, _b2, _c;
        return {
          title: (_a2 = fm.title) != null ? _a2 : "Untitled",
          meta: (_b2 = fm.category) != null ? _b2 : "",
          badge: (_c = fm.category) != null ? _c : ""
        };
      }
    );
    await this.renderSection(
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
      }
    );
    scroll.scrollTop = scrollTop;
    for (const { id } of tabs) this.applySearch(id);
    updateShadow();
    if (searchHadFocus) {
      searchInput.focus();
      const end = searchInput.value.length;
      searchInput.setSelectionRange(end, end);
    }
  }
  /**
   * Hides the cards on one tab that don't match its search text (and, on Characters, any employer
   * section left empty). Every word typed must appear in the card's searchable text, in any order,
   * ignoring case and accents. Works on the existing cards, so nothing is re-read or re-rendered.
   * Characters are matched on name, employer, ship and home; other tabs on the name and the note's text.
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
    body.querySelectorAll(".wb-group-header").forEach((header) => {
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
    const none = body.querySelector(".wb-no-results");
    if (none) {
      none.textContent = `No ${(_a = none.getAttribute("data-noun")) != null ? _a : "entries"} match \u201C${query.trim()}\u201D.`;
      none.classList.toggle("wb-filtered-out", !(searching && matches === 0));
    }
  }
  /** Returns a displayable URL for the first image embedded in a note, or null. */
  findFirstImageSrc(content, file) {
    var _a, _b;
    const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
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
  async renderSection(pane, folderPath, label, onCreate, getCard, opts = {}) {
    var _a, _b, _c;
    const container = pane.body;
    const hdr = pane.head.createDiv("wb-section-header");
    hdr.createEl("span", { text: label });
    const actions = hdr.createDiv("wb-section-actions");
    if ((_a = opts.reload) != null ? _a : true) {
      const reloadBtn = actions.createEl("button", { cls: "wb-btn-secondary" });
      (0, import_obsidian.setIcon)(reloadBtn.createEl("span", { cls: "wb-btn-icon" }), "refresh-cw");
      reloadBtn.createEl("span", { text: "Reload" });
      reloadBtn.onclick = async () => {
        await this.render();
        new import_obsidian.Notice("World Builder reloaded.");
      };
    }
    const btn = actions.createEl("button", { text: "+ New", cls: "wb-btn-primary" });
    btn.onclick = onCreate;
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
      entries.push({ file, content, fm: readFrontmatter(content) });
    }
    if (!opts.employerGroups) {
      const list = container.createDiv("wb-list");
      for (const entry of entries) this.renderCard(list, entry, getCard, !!opts.thumbs, !!opts.stackBadge);
      this.createNoResultsLine(container, label);
      return;
    }
    const groups = /* @__PURE__ */ new Map();
    for (const entry of entries) {
      const employer = ((_b = entry.fm.employer) != null ? _b : "").trim();
      const key = employer.toLowerCase();
      let group = groups.get(key);
      if (!group) {
        group = { label: employer || "No Employer", items: [] };
        groups.set(key, group);
      }
      group.items.push(entry);
    }
    const orderedGroups = [...groups.entries()].sort(
      ([a], [b]) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0) || a.localeCompare(b)
    );
    for (const [key, group] of orderedGroups) {
      const header = container.createDiv("wb-group-header");
      header.setAttribute("role", "button");
      header.setAttribute("tabindex", "0");
      (0, import_obsidian.setIcon)(header.createEl("span", { cls: "wb-group-chevron" }), "chevron-down");
      header.createEl("span", { cls: "wb-group-title", text: group.label });
      const list = container.createDiv("wb-list");
      const applyCollapsed = (collapsed) => {
        header.classList.toggle("is-collapsed", collapsed);
        list.classList.toggle("is-collapsed", collapsed);
        header.setAttribute("aria-expanded", String(!collapsed));
      };
      applyCollapsed(this.plugin.settings.collapsedEmployers.includes(key));
      const toggleCollapsed = async () => {
        if (normalizeForSearch(this.searchQueries.characters).trim()) return;
        const settings = this.plugin.settings;
        const collapse = !settings.collapsedEmployers.includes(key);
        settings.collapsedEmployers = collapse ? [...settings.collapsedEmployers, key] : settings.collapsedEmployers.filter((k) => k !== key);
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
      const saved = (_c = this.plugin.settings.characterOrder[key]) != null ? _c : [];
      const rank = (path) => {
        const i = saved.indexOf(path);
        return i === -1 ? saved.length : i;
      };
      const items = group.items.map((entry, index) => ({ entry, index })).sort((a, b) => rank(a.entry.file.path) - rank(b.entry.file.path) || a.index - b.index).map(({ entry }) => entry);
      for (const entry of items) this.renderCard(list, entry, getCard, !!opts.thumbs, !!opts.stackBadge);
      this.enableReorder(list, key);
    }
    this.createNoResultsLine(container, label);
  }
  /** The "No ... match" line; hidden until applySearch() finds nothing. */
  createNoResultsLine(container, label) {
    container.createDiv({
      cls: "wb-empty wb-no-results wb-filtered-out",
      attr: { "data-noun": label.toLowerCase() }
    });
  }
  renderCard(parent, entry, getCard, thumbs, stackBadge) {
    const { file, content, fm } = entry;
    const { title, meta, badge, search } = getCard(fm);
    const card = parent.createDiv("wb-card");
    if (stackBadge) card.addClass("wb-card-stacked");
    card.setAttribute("data-path", file.path);
    this.searchIndex.set(card, normalizeForSearch(search != null ? search : `${title} ${documentSearchText(content, fm)}`));
    let body = card;
    if (thumbs) {
      card.addClass("wb-card-with-thumb");
      const thumb = card.createDiv("wb-thumb");
      const src = this.findFirstImageSrc(content, file);
      if (src) {
        const img = thumb.createEl("img", { attr: { src, alt: "", draggable: "false" } });
        img.onerror = () => img.remove();
      }
      body = card.createDiv("wb-card-body");
    }
    const titleEl = body.createDiv("wb-card-title");
    titleEl.setText(title);
    if (badge) {
      const badgeHost = stackBadge ? body.createDiv("wb-card-badge-row") : titleEl;
      const b = badgeHost.createSpan({ cls: `wb-badge wb-badge-${badge.toLowerCase()}` });
      b.setText(badge);
    }
    if (meta) for (const line of meta.split("\n")) body.createDiv({ cls: "wb-card-meta", text: line });
    card.onclick = () => this.app.workspace.getLeaf().openFile(file);
    return card;
  }
  /**
   * Makes the cards in one employer's list drag-sortable. Each list only accepts cards
   * that were picked up from that same list, so characters can't be moved between employers.
   * The new order is saved to plugin data (notes themselves are never modified).
   */
  enableReorder(list, groupKey) {
    let dragged = null;
    let dropTarget = null;
    let dropAfter = false;
    const cardAt = (t) => t instanceof HTMLElement ? t.closest(".wb-card") : null;
    const clearMarks = () => {
      list.querySelectorAll(".wb-drop-before, .wb-drop-after").forEach(
        (el) => el.classList.remove("wb-drop-before", "wb-drop-after")
      );
      dropTarget = null;
    };
    list.querySelectorAll(".wb-card").forEach(
      (card) => card.setAttribute("draggable", "true")
    );
    list.addEventListener("dragstart", (e) => {
      var _a;
      const card = cardAt(e.target);
      if (!card || !e.dataTransfer) return;
      dragged = card;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/x-wb-character", (_a = card.getAttribute("data-path")) != null ? _a : "");
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
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const target = cardAt(e.target);
      if (!target) return;
      clearMarks();
      if (target === dragged) return;
      const r = target.getBoundingClientRect();
      dropTarget = target;
      dropAfter = e.clientY >= r.top + r.height / 2;
      target.classList.add(dropAfter ? "wb-drop-after" : "wb-drop-before");
    });
    list.addEventListener("dragleave", (e) => {
      if (!list.contains(e.relatedTarget)) clearMarks();
    });
    list.addEventListener("drop", async (e) => {
      if (!dragged) return;
      e.preventDefault();
      const moving = dragged;
      if (dropTarget && dropTarget !== moving) {
        list.insertBefore(moving, dropAfter ? dropTarget.nextSibling : dropTarget);
        this.plugin.settings.characterOrder[groupKey] = Array.from(
          list.querySelectorAll(".wb-card")
        ).map((c) => {
          var _a;
          return (_a = c.getAttribute("data-path")) != null ? _a : "";
        });
        await this.plugin.saveSettings();
      }
      clearMarks();
    });
  }
};
var CharacterModal = class extends import_obsidian.Modal {
  constructor(app, plugin, onDone) {
    super(app);
    this.data = {
      name: "",
      role: "protagonist",
      age: "",
      employer: "",
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
      d.onChange((v) => this.data.role = v);
    });
    new import_obsidian.Setting(contentEl).setName("Age").addText((t) => {
      t.setPlaceholder("e.g. 34").onChange((v) => this.data.age = v);
    });
    new import_obsidian.Setting(contentEl).setName("Employer").addText((t) => {
      t.setPlaceholder("Employer name").onChange((v) => this.data.employer = v);
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
      `employer: "${this.data.employer}"`,
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
      type: "city",
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
      ["planet", "moon", "station", "asteroid", "ship", "city", "region", "building", "landmark", "other"].forEach(
        (o) => d.addOption(o, o.charAt(0).toUpperCase() + o.slice(1))
      );
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
var EmployerModal = class extends import_obsidian.Modal {
  constructor(app, plugin, onDone) {
    super(app);
    this.data = {
      name: "",
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
    contentEl.createEl("h2", { text: "New Employer" });
    new import_obsidian.Setting(contentEl).setName("Name").addText((t) => {
      t.setPlaceholder("Employer name").onChange((v) => this.data.name = v);
    });
    new import_obsidian.Setting(contentEl).setName("Alignment").addDropdown((d) => {
      ["lawful", "neutral", "chaotic"].forEach(
        (o) => d.addOption(o, o.charAt(0).toUpperCase() + o.slice(1))
      );
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
    if (!this.data.name.trim()) {
      new import_obsidian.Notice("Name is required.");
      return;
    }
    const folder = `${this.plugin.settings.worldFolder}/Employers`;
    const enemyLinks = this.data.enemies.split(",").filter(Boolean).map((e) => `[[${e.trim()}]]`).join(", ");
    const allyLinks = this.data.allies.split(",").filter(Boolean).map((a) => `[[${a.trim()}]]`).join(", ");
    const lines = [
      "---",
      `name: "${this.data.name}"`,
      `alignment: ${this.data.alignment}`,
      `goals: "${this.data.goals.replace(/"/g, "'")}"`,
      `entry_type: employer`,
      "---",
      "",
      `# ${this.data.name}`,
      "",
      `**Alignment:** ${this.data.alignment}`
    ];
    if (enemyLinks) lines.push(`**Enemies:** ${enemyLinks}`);
    if (allyLinks) lines.push(`**Allies:** ${allyLinks}`);
    lines.push("", "## Goals", this.data.goals || "_None provided._", "", "## Description", this.data.description || "_None provided._");
    const file = await createNote(this.app, folder, this.data.name, lines.join("\n"));
    new import_obsidian.Notice(`Employer "${this.data.name}" created.`);
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
  }
};
var WorldBuilderPlugin = class extends import_obsidian.Plugin {
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new WorldBuilderView(leaf, this));
    this.addRibbonIcon("globe", "World Builder", () => this.activateSidebar());
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
      id: "new-employer",
      name: "New Employer",
      callback: () => new EmployerModal(this.app, this, () => this.refreshSidebar()).open()
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
        if (changed) await this.saveSettings();
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
    var _a, _b;
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    this.settings.characterOrder = (_a = data == null ? void 0 : data.characterOrder) != null ? _a : {};
    this.settings.collapsedEmployers = (_b = data == null ? void 0 : data.collapsedEmployers) != null ? _b : [];
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
