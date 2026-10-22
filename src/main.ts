import {
  Plugin,
  WorkspaceLeaf,
  addIcon,
  TAbstractFile,
  TFile,
  TFolder,
  Menu,
  MarkdownView,
  MarkdownPostProcessorContext,
  Notice,
  TextFileView,
  type Editor,
  getLinkpath,
  HoverPopover,
  Keymap,
  type HoverParent,
  type MarkdownFileInfo,
  parseYaml,
  stringifyYaml,
} from 'obsidian';
import { CookView } from './cookView'
import { CooklangSettings, CookSettingsTab } from './settings'
import { AlarmCoordinator } from './services/AlarmCoordinator';
import alarmMp3 from './alarm.mp3';
import { ObsidianRecipeHost } from './ui/ObsidianRecipeHost';
import changelog from '../CHANGELOG.md';
import { ChangelogModal } from './ui/ChangelogModal';
import { releaseNotesForUpdate } from './utils/releaseNotes';
import { cooklangFormat, isMenuFile, isRecipeFile, menuFormatFor, newMenuContent, newRecipeContent, recipeFormat, recipeConversionPath,
  RECIPE_FORMATS, type RecipeFormat } from './utils/recipeFiles';
import { RecipeViewRouter } from './services/RecipeViewRouter';
import { convertRecipe, synchronizeRecipeBuffers } from './services/RecipeConversion';
import { RecipeFormatModal } from './ui/RecipeFormatModal';
import { RecipeEmbedChild } from './ui/RecipeEmbedChild';
import { RecipeReferenceSuggest } from './ui/RecipeReferenceSuggest';
import { wholeRecipeEmbedRoot, WholeRecipeEmbedRegistry } from './utils/wholeRecipeEmbeds';
import { nativeCookEditor, sourceReferenceEvents } from './mode/cook/nativeEditor';
import { menuLinkNames } from './mode/cook/menuLinkNames';
import { menuLinkText, menuSuffixStart } from './utils/menuLinks';
import { isRecipeSource } from './utils/recipeSource';
import { RecipeSessions, type RecipeSession } from './services/RecipeSessions';
import { TimerService } from './services/TimerService';
import timerMp3 from './timer.mp3';
import type { RecipeReferenceScaleRequest } from './utils/scaling';
import { createUiInstanceId } from './ui/instanceIds';
import type { RecipeRefTarget } from './utils/ingredientAggregator';
import { referenceAt, type SourceReference } from './utils/sourceReferences';
import { vaultPathsFromObsidianUrls } from './utils/referenceDrops';

/** Obsidian's drag state for files dragged within the app; not public API. */
interface DragManager {
  draggable?: { type?: string; file?: TAbstractFile; files?: TAbstractFile[] } | null;
}

/** The parts of Obsidian's bundled CodeMirror Vim API used for `gf`. */
interface VimApi {
  defineAction(name: string, action: () => void): void;
  mapCommand(keys: string, type: 'action', name: string, args: object, extra: { context: 'normal' }): void;
  unmap(keys: string, context: 'normal'): void;
}

export default class CookPlugin extends Plugin {

  settings!: CooklangSettings;
  recipeHost!: ObsidianRecipeHost;
  private alarms!: AlarmCoordinator;
  private router!: RecipeViewRouter<WorkspaceLeaf>;
  private conversions = new Set<TFile>();
  private renderChildren = new Set<RecipeEmbedChild>();
  private disposed = false;
  private sessions!: RecipeSessions<WorkspaceLeaf, RecipeSession>;
  private routeTimeout: number | null = null;
  private routingReady = false;
  private referenceHover: { parent: HoverParent; path: string; popover: HoverPopover } | null = null;

  saveData(data: CooklangSettings): Promise<void> {
    const settings = { ...data } as CooklangSettings & { lineWrap?: unknown };
    delete settings.lineWrap;
    return super.saveData(settings);
  }

  private routeLeaves = (): void => {
    if (this.disposed || !this.routingReady || this.routeTimeout !== null) return;
    // Never change a leaf synchronously from a CodeMirror update or a view teardown.
    this.routeTimeout = window.setTimeout(() => {
      this.routeTimeout = null;
      if (this.disposed) return;
      const leaves = new Map<WorkspaceLeaf, string>();
      this.app.workspace.iterateAllLeaves(leaf => {
        const path = leaf.view instanceof TextFileView ? leaf.view.file?.path : leaf.getViewState().state?.file;
        leaves.set(leaf, typeof path === 'string' ? path : '');
        void this.router.route(leaf);
      });
      this.sessions.reconcile(leaves);
    }, 0);
  };

  async onload() {
    super.onload();
    this.register(() => { this.disposed = true; });
    const storedData = await this.loadData();
    const isFirstInstall = storedData == null;
    this.settings = Object.assign(new CooklangSettings(), storedData ?? {});
    delete (this.settings as CooklangSettings & { lineWrap?: unknown }).lineWrap;
    if (!RECIPE_FORMATS.includes(this.settings.defaultRecipeFormat)) this.settings.defaultRecipeFormat = 'cook';
    this.alarms = new AlarmCoordinator(this.settings.timersRing, alarmMp3);
    this.register(() => this.alarms.dispose());
    this.sessions = new RecipeSessions(() => {
      const timers = new TimerService(this.settings, { tickSoundUrl: timerMp3, tickVolume: 0.3 }, this.alarms);
      const checkedIngredients = new Set<string>();
      return { instanceId: createUiInstanceId('cook-session'), scale: 1, currentStep: -1, checkedIngredients, pendingReferenceScale: null, timers,
        dispose: () => { timers.dispose(); checkedIngredients.clear(); } };
    });
    this.register(() => {
      this.sessions.dispose();
      if (this.routeTimeout !== null) window.clearTimeout(this.routeTimeout);
    });

    // register a custom icon
    this.addDocumentIcon("cook");
    this.addMenuIcon();

    // register the view and extensions
    this.registerView("cook", this.cookViewCreator);
    this.registerExtensions(["cook", "menu"], "markdown");
    this.registerEditorExtension(nativeCookEditor(this.routeLeaves));
    this.registerEditorExtension(sourceReferenceEvents({
      open: this.openSourceReference,
      hover: this.hoverSourceReference,
      droppedRecipes: this.droppedRecipes,
    }));
    this.registerEditorSuggest(new RecipeReferenceSuggest(this.app));

    // Render ```cook / ```cooklang fenced blocks inside markdown notes as a
    // compact, read-only recipe (#73).
    this.recipeHost = new ObsidianRecipeHost(this.app, (leaf, reference) => {
      const file = this.app.vault.getAbstractFileByPath(reference.targetPath);
      if (file instanceof TFile) void this.openAsRecipe(leaf, file, reference.scaleRequest);
    });
    this.register(() => {
      for (const child of this.renderChildren) child.unload();
      this.renderChildren.clear();
    });

    const renderRecipeBlock = async (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> => {
      el.empty();
      const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      const child = new RecipeEmbedChild(el, el, this.app, file instanceof TFile ? file : null,
        () => this.settings, this.recipeHost, source, () => this.renderChildren.delete(child));
      this.renderChildren.add(child);
      ctx.addChild(child);
      await child.refresh();
    };
    this.registerMarkdownCodeBlockProcessor('cook', renderRecipeBlock);
    this.registerMarkdownCodeBlockProcessor('cooklang', renderRecipeBlock);

    // Links to menus read without `.menu`, as links to notes read without `.md`.
    this.registerEditorExtension(menuLinkNames(this.isMenuLink));
    this.registerMarkdownPostProcessor((el, ctx) => {
      for (const link of Array.from(el.querySelectorAll<HTMLAnchorElement>('a.internal-link'))) {
        const href = link.getAttribute('data-href');
        // Aliased and heading links show other text and keep it.
        if (!href || link.textContent !== href || menuSuffixStart(href) === null) continue;
        if (this.isMenuLink(href, ctx.sourcePath)) link.setText(menuLinkText(href));
      }
    });

    const embeds = new WholeRecipeEmbedRegistry();
    this.registerMarkdownPostProcessor(async (el, ctx) => {
      const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      // Menus are left as Markdown in transclusions; only recipes get the compact embed.
      if (!(file instanceof TFile) || file.extension !== 'md' || isMenuFile(file.path)
          || !isRecipeFile(file.path, ctx.frontmatter ?? this.app.metadataCache.getFileCache(file)?.frontmatter)) return;
      const root = await wholeRecipeEmbedRoot(el);
      if (!root || this.disposed) return;
      const target = el.ownerDocument.createElement('div');
      target.className = 'cook-whole-recipe';
      const cleanup = () => {
        root.classList.remove('cook-recipe-note-embed');
        target.remove();
      };
      if (!embeds.claim(root, cleanup)) return;
      root.classList.add('cook-recipe-note-embed');
      root.appendChild(target);
      const child = new RecipeEmbedChild(el, target, this.app, file, () => this.settings,
        this.recipeHost, undefined, () => {
          embeds.release(root, cleanup);
          this.renderChildren.delete(child);
        });
      this.renderChildren.add(child);
      ctx.addChild(child);
      await child.refresh();
    });

    this.router = new RecipeViewRouter(
      (path, leaf) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return false;
        if (isRecipeFile(path)) return true;
        if (leaf.view instanceof MarkdownView && leaf.view.file === file) {
          return isRecipeSource(path, leaf.view.editor.getValue(), parseYaml);
        }
        const cache = this.app.metadataCache.getFileCache(file);
        return cache ? isRecipeFile(path, cache.frontmatter) : undefined;
      },
      async (leaf, type, path, isCurrent) => {
        if (leaf.view instanceof TextFileView) await leaf.view.save();
        // Saving may yield while the user navigates to another note.
        if (!isCurrent()) return;
        await this.sessions.preserve(leaf, () => leaf.setViewState({ type,
          state: { file: path, mode: type === 'cook' ? 'preview' : 'source', source: true, sync: true } }));
        this.routeLeaves();
      },
      error => this.reportError('Could not open recipe', error),
      () => this.settings.defaultView,
    );
    this.register(() => this.router.dispose());
    const routeLeaves = this.routeLeaves;
    this.registerEvent(this.app.workspace.on('active-leaf-change', routeLeaves));
    this.registerEvent(this.app.workspace.on('file-open', routeLeaves));
    this.registerEvent(this.app.workspace.on('layout-change', routeLeaves));
    this.registerEvent(this.app.metadataCache.on('changed', routeLeaves));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.sessions.rename(oldPath, file.path);
      this.app.workspace.iterateAllLeaves(leaf => this.router.rename(leaf, oldPath, file.path));
      this.app.workspace.updateOptions();
      routeLeaves();
    }));
    this.registerEvent(this.app.vault.on('delete', file => this.sessions.delete(file.path)));
    this.app.workspace.onLayoutReady(() => {
      if (this.disposed) return;
      // Default view applies to new navigation, not restored native source tabs.
      this.app.workspace.iterateAllLeaves(leaf => {
        const state = leaf.getViewState();
        if (state.type === 'markdown' && state.state?.mode === 'source' && typeof state.state.file === 'string') {
          this.router.editAsMarkdown(leaf, state.state.file);
        }
      });
      this.routingReady = true;
      routeLeaves();
      this.extendFollowLinkCommand();
      this.registerVimFollow();
    });

    this.addSettingTab(new CookSettingsTab(this.app, this));

    // Register file explorer context menu
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
        if (file instanceof TFolder) {
          // Add "New recipe" option for folders
          menu.addItem((item) => {
            item
              .setTitle('New recipe')
              .setIcon('document-cook')
              .setSection('action-primary')
              .onClick(async () => {
                const folderPath = file.path;
                const newFile = await this.cookFileCreator(folderPath);
                this.app.workspace.getLeaf().openFile(newFile);
              });
          });
          menu.addItem(item => item
            .setTitle('New menu')
            .setIcon('document-menu')
            .setSection('action-primary')
            .onClick(async () => {
              const newFile = await this.menuFileCreator(file.path);
              await this.app.workspace.getLeaf().openFile(newFile);
            }));
        }

        if (file instanceof TFile && cooklangFormat(file.path)) {
          menu.addItem(item => item
            .setTitle('Open as Recipe')
            .setIcon('document-cook')
            .onClick(() => this.openAsRecipe(this.app.workspace.getLeaf(), file)));
        }
      })
    );

    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
      const file = view.file;
      const reference = this.referenceUnderCursor(editor, file);
      if (file && reference) {
        menu.addItem(item => item
          .setTitle('Open recipe reference')
          .setIcon('document-cook')
          .onClick(() => this.openSourceReference(file.path, reference.target)));
      }
      if (file && cooklangFormat(file.path)) {
        menu.addItem(item => item
          .setTitle('Open as Recipe')
          .setIcon('document-cook')
          .onClick(() => {
            const leaf = view instanceof MarkdownView ? view.leaf : this.app.workspace.activeLeaf;
            if (leaf) void this.openAsRecipe(leaf, file);
          }));
      }
    }));

    // commands:
    // - Create new recipe
    // - Create recipe in new pane
    // - Convert markdown file to `.cook`
    // - Toggle preview recipe

    this.addCommand({
      id: "create-cook",
      name: "Create new recipe",
      callback: async () => {
        const newFile = await this.cookFileCreator();
        this.app.workspace.getLeaf().openFile(newFile);
      }
    })

    this.addCommand({
      id: "create-cook-new-pane",
      name: "Create recipe in new pane",
      callback: async () => {
        const newFile = await this.cookFileCreator();
        await this.app.workspace.getLeaf(true).openFile(newFile);
      }
    })

    this.addCommand({
      id: 'open-recipe-reference',
      name: 'Open recipe reference under cursor',
      editorCheckCallback: (checking, editor, ctx) => {
        const file = ctx.file;
        const reference = this.referenceUnderCursor(editor, file);
        if (!file || !reference) return false;
        if (!checking) this.openSourceReference(file.path, reference.target);
        return true;
      },
    });

    this.addCommand({
      id: "create-menu",
      name: "Create new menu",
      callback: async () => {
        const newFile = await this.menuFileCreator();
        await this.app.workspace.getLeaf().openFile(newFile);
      }
    })

    this.addCommand({
      id: 'convert-recipe-extension',
      name: 'Convert recipe file format',
      checkCallback: checking => {
        const file = this.app.workspace.getActiveFile();
        const leaf = this.app.workspace.activeLeaf;
        if (!file || !leaf) return false;
        const format = recipeFormat(file.path);
        if (!format || !((leaf.view instanceof MarkdownView
            ? isRecipeSource(file.path, leaf.view.editor.getValue(), parseYaml)
            : isRecipeFile(file.path, this.app.metadataCache.getFileCache(file)?.frontmatter))
            || leaf.view instanceof CookView)) return false;
        if (!checking) new RecipeFormatModal(this.app, format, target => {
          void this.convertFile(file, leaf, target);
        }).open();
        return true;
      },
    });

    this.addCommand({
      id: 'edit-as-markdown',
      name: 'Edit recipe source',
      checkCallback: checking => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf || !(leaf.view instanceof CookView) || !leaf.view.file) return false;
        if (!checking) void this.editAsMarkdown(leaf);
        return true;
      },
    });

    this.addCommand({
      id: "toggle-preview-recipe",
      name: "Toggle preview recipe",
      checkCallback: checking => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf) return false;
        const view = leaf.view;
        if (view instanceof CookView) {
          if (!checking) void this.editAsMarkdown(leaf);
          return true;
        }
        if (!(view instanceof MarkdownView) || !view.file
            || !isRecipeSource(view.file.path, view.editor.getValue(), parseYaml)) return false;
        if (!checking) void this.openAsRecipe(leaf, view.file);
        return true;
      },
    });

    this.addCommand({
      id: "open-as-recipe",
      name: "Open current file as recipe",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        const leaf = this.app.workspace.activeLeaf;
        
        if (!file || !leaf || !cooklangFormat(file.path)) return false;
        
        // Only show if currently in markdown view
        if (checking) return leaf.view.getViewType() === 'markdown';
        
        void this.openAsRecipe(leaf, file);
        return true;
      }
    });

    await this.showReleaseNotesAfterUpdate(isFirstInstall);
  }

  /** Follows a `@./…{…}` reference like a preview link, including its scale. */
  private openSourceReference = (sourcePath: string, target: RecipeRefTarget): void => {
    const source = this.app.vault.getAbstractFileByPath(sourcePath);
    const resolved = this.recipeHost.resolveReference(source instanceof TFile ? source : null, target);
    if (!resolved) {
      const path = [...target.components.filter(part => part && part !== '.'), target.name].join('/');
      new Notice(`Recipe not found: ${path}`);
      return;
    }
    this.recipeHost.openReference(resolved);
  };

  /**
   * Mod+hover shows the recipe in a popover, like an editor `[[link]]` preview.
   * Obsidian's page preview cannot render `.cook` files, so the popover holds
   * the plugin's compact, read-only recipe render instead.
   */
  private hoverSourceReference = (sourcePath: string, target: RecipeRefTarget, event: MouseEvent,
      targetEl: HTMLElement, info: MarkdownFileInfo | null): void => {
    if (!Keymap.isModEvent(event)) return;
    const source = this.app.vault.getAbstractFileByPath(sourcePath);
    const resolved = this.recipeHost.resolveReference(source instanceof TFile ? source : null, target);
    const file = resolved && this.app.vault.getAbstractFileByPath(resolved.targetPath);
    if (!(file instanceof TFile)) return;
    const parent: HoverParent = info && 'hoverPopover' in info ? info as unknown as HoverParent : { hoverPopover: null };
    // Moving between the spans of one reference fires mouseover repeatedly; keep its popover.
    const current = this.referenceHover;
    if (current?.parent === parent && current.path === file.path && current.popover.hoverEl.isConnected) return;

    const popover = new HoverPopover(parent, targetEl);
    this.referenceHover = { parent, path: file.path, popover };
    popover.hoverEl.addClass('cook-hover-popover');
    const content = popover.hoverEl.createDiv({ cls: 'cook-hover-content' });
    const child = new RecipeEmbedChild(content, content, this.app, file, () => this.settings, this.recipeHost, undefined,
      () => this.renderChildren.delete(child), 'hover');
    this.renderChildren.add(child);
    popover.addChild(child);
    void child.refresh();
  };

  /**
   * Paths of recipes dragged from the file explorer, search, or a tab, or null
   * when anything else is dropped so Obsidian handles it as usual. The dragged
   * files come from Obsidian's drag manager, falling back to the
   * `obsidian://open` links a file drag carries.
   */
  private droppedRecipes = (event: DragEvent): string[] | null => {
    const draggable = (this.app as unknown as { dragManager?: DragManager }).dragManager?.draggable;
    let files: TAbstractFile[] = draggable?.type === 'file' && draggable.file ? [draggable.file]
      : draggable?.type === 'files' && draggable.files ? draggable.files : [];
    if (!files.length) {
      const links = `${event.dataTransfer?.getData('text/uri-list') ?? ''}\n${event.dataTransfer?.getData('text/plain') ?? ''}`;
      files = [...new Set(vaultPathsFromObsidianUrls(links))].flatMap(path => {
        const file = this.app.vault.getAbstractFileByPath(path) ?? this.app.vault.getAbstractFileByPath(`${path}.md`);
        return file ? [file] : [];
      });
    }
    const recipes = files.filter((file): file is TFile => file instanceof TFile && !isMenuFile(file.path)
      && isRecipeFile(file.path, this.app.metadataCache.getFileCache(file)?.frontmatter));
    // Mixed drops keep Obsidian's behavior for all files rather than splitting them.
    return recipes.length && recipes.length === files.length ? recipes.map(file => file.path) : null;
  };

  private isMenuLink = (linktext: string, sourcePath: string): boolean => {
    const file = this.app.metadataCache.getFirstLinkpathDest(getLinkpath(linktext), sourcePath);
    return !!file && isMenuFile(file.path);
  };

  private referenceUnderCursor(editor: Editor, file: TFile | null): SourceReference | null {
    if (!file || !isRecipeSource(file.path, editor.getValue(), parseYaml)) return null;
    const cursor = editor.getCursor();
    return referenceAt(editor.getLine(cursor.line), cursor.ch);
  }

  /**
   * Obsidian's "Follow link under cursor" also follows a recipe reference. Vim
   * `gf` mappings (Vimrc Support's, or ours below) and the command's hotkey all
   * run this command, so wrapping it works whichever mapping wins. The command
   * registry is not public API; when its shape differs, it is left untouched.
   */
  private extendFollowLinkCommand(): void {
    type CheckCallback = (checking: boolean) => boolean | void;
    const registry = (this.app as unknown as { commands?: { commands?: Record<string, { checkCallback?: CheckCallback }> } })
      .commands?.commands;
    const command = registry?.['editor:follow-link'];
    const original = command?.checkCallback;
    if (this.disposed || !command || typeof original !== 'function') return;
    const extended: CheckCallback = checking => {
      const active = this.app.workspace.activeEditor;
      const file = active?.file ?? null;
      const reference = active?.editor ? this.referenceUnderCursor(active.editor, file) : null;
      if (!file || !reference) return original.call(command, checking);
      if (!checking) this.openSourceReference(file.path, reference.target);
      return true;
    };
    command.checkCallback = extended;
    this.register(() => {
      if (command.checkCallback === extended) command.checkCallback = original;
    });
  }

  /**
   * Obsidian's Vim mode has no `gf`; map it to "Follow link under cursor". A
   * vimrc plugin that maps `gf` later takes precedence, which is fine when it
   * runs the same command. The Vim API is only reachable through Obsidian's
   * global CodeMirror adapter.
   */
  private registerVimFollow(): void {
    const vim = (window as unknown as { CodeMirrorAdapter?: { Vim?: VimApi } }).CodeMirrorAdapter?.Vim;
    if (this.disposed || !vim) return;
    vim.defineAction('cooklangFollowLink', () => {
      const commands = (this.app as unknown as { commands?: { executeCommandById(id: string): boolean } }).commands;
      commands?.executeCommandById('editor:follow-link');
    });
    vim.mapCommand('gf', 'action', 'cooklangFollowLink', {}, { context: 'normal' });
    this.register(() => {
      try {
        vim.unmap('gf', 'normal');
      } catch {
        // Another plugin or a vimrc may already have replaced the mapping.
      }
    });
  }

  private reportError(message: string, error: unknown): void {
    console.error(message, error);
    new Notice(`${message}: ${error instanceof Error ? error.message : String(error)}`);
  }

  private async openAsRecipe(leaf: WorkspaceLeaf, file: TFile, referenceScale: RecipeReferenceScaleRequest | null = null): Promise<void> {
    const view = leaf.view;
    const originalFile = view instanceof TextFileView ? view.file : null;
    try {
      if (view instanceof TextFileView) await view.save();
      if (this.disposed || leaf.view !== view || (view instanceof TextFileView && view.file !== originalFile)) return;
      this.router.openAsRecipe(leaf);
      await this.sessions.preserve(leaf, () => leaf.setViewState({ type: 'cook',
        state: { file: file.path, mode: 'preview', referenceScale, sync: view instanceof TextFileView && view.file === file } }));
    } catch (error) {
      this.reportError('Could not open recipe', error);
    } finally {
      this.routeLeaves();
    }
  }

  private editAsMarkdown = async (leaf: WorkspaceLeaf): Promise<void> => {
    const view = leaf.view;
    if (!(view instanceof CookView) || !view.file) return;
    const file = view.file;
    try {
      await view.save();
      if (this.disposed || leaf.view !== view || view.file !== file) return;
      this.router.editAsMarkdown(leaf, file.path);
      await this.sessions.preserve(leaf, () => leaf.setViewState({ type: 'markdown',
        state: { file: file.path, mode: 'source', source: true, sync: true } }));
    } catch (error) {
      this.router.openAsRecipe(leaf);
      this.reportError('Could not edit recipe source', error);
    } finally {
      this.routeLeaves();
    }
  };

  private async convertFile(file: TFile, leaf: WorkspaceLeaf, target: RecipeFormat): Promise<void> {
    if (this.conversions.has(file)) return;
    const originalPath = file.path;
    this.conversions.add(file);
    this.router.suspend(originalPath);
    // Both names are suspended because rename events fire before renameFile resolves.
    const destination = recipeConversionPath(originalPath, target);
    this.router.suspend(destination);
    const openViews = (): TextFileView[] => {
      const views: TextFileView[] = [];
      this.app.workspace.iterateAllLeaves(openLeaf => {
        if (openLeaf.view instanceof TextFileView && openLeaf.view.file === file) views.push(openLeaf.view);
      });
      return views;
    };
    try {
      await convertRecipe({
        path: () => file.path,
        exists: path => this.app.vault.getAbstractFileByPath(path) !== null,
        save: async () => {
          const views = openViews();
          const contents = new Set(views.map(view => view.getViewData()));
          if (contents.size > 1) throw new Error('Open editors disagree. Save your edits before converting.');
          for (const view of views) await view.save();
        },
        read: () => this.app.vault.read(file),
        process: async update => {
          await this.app.vault.process(file, current => {
            if (openViews().some(view => view.getViewData() !== current)) {
              throw new Error('An open editor changed during conversion. Please save it and try again.');
            }
            return update(current);
          });
        },
        synchronize: (previous, next) => synchronizeRecipeBuffers(openViews().map(view => ({
          read: () => view.file === file ? view.getViewData() : next,
          replace: content => view.setViewData(content, false),
        })), previous, next),
        rename: path => this.app.fileManager.renameFile(file, path),
        // An empty append with a newer mtime sends Obsidian a real modify event
        // without rewriting content or overwriting concurrent editor changes.
        refreshMetadata: () => this.app.vault.append(file, '', {
          mtime: Math.max(Date.now(), file.stat.mtime + 1),
        }),
      }, target, { parse: parseYaml, stringify: stringifyYaml });
      const currentPath = leaf.getViewState().state?.file;
      if (currentPath === originalPath || currentPath === file.path) await this.openAsRecipe(leaf, file);
      new Notice(`Recipe converted to ${file.path}`);
    } catch (error) {
      this.reportError(`Conversion failed; recipe is at ${file.path}`, error);
    } finally {
      this.conversions.delete(file);
      this.router.resume(originalPath);
      this.router.resume(destination);
      this.app.workspace.iterateAllLeaves(openLeaf => { void this.router.route(openLeaf); });
    }
  }

  private async showReleaseNotesAfterUpdate(isFirstInstall: boolean): Promise<void> {
    const currentVersion = this.manifest.version;
    const previousVersion = this.settings.lastSeenVersion;

    if (previousVersion === currentVersion) return;

    this.settings.lastSeenVersion = currentVersion;
    try {
      await this.saveData(this.settings);
    } catch (error) {
      console.error('Could not save the Cooklang release-notes version.', error);
    }

    const notes = releaseNotesForUpdate(
      changelog,
      currentVersion,
      previousVersion,
      isFirstInstall,
    );
    if (!notes) return;

    this.app.workspace.onLayoutReady(() => {
      new ChangelogModal(
        this.app,
        this.manifest.name,
        currentVersion,
        notes,
      ).open();
    });
  }

  cookFileCreator = async (folderPath?: string) => {
    const format = this.settings.defaultRecipeFormat;
    return this.createUntitledFile(format, newRecipeContent(format), folderPath);
  }

  menuFileCreator = async (folderPath?: string) => {
    return this.createUntitledFile(menuFormatFor(this.settings.defaultRecipeFormat), newMenuContent(), folderPath);
  }

  private createUntitledFile = async (format: string, content: string, folderPath?: string) => {
    // Default to root folder
    let newFileFolderPath = '';

    // Use provided folder path, or try to get the current file's parent folder
    if (folderPath) {
      newFileFolderPath = folderPath;
    } else {
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile && activeFile.parent) {
        newFileFolderPath = activeFile.parent.path;
      }
    }

    // Ensure path ends with a slash
    if (newFileFolderPath === '/') newFileFolderPath = '';
    if (newFileFolderPath && !newFileFolderPath.endsWith('/')) newFileFolderPath += '/';

    const originalPath = newFileFolderPath;
    newFileFolderPath = `${newFileFolderPath}Untitled.${format}`;
    let i = 0;
    while(this.app.vault.getAbstractFileByPath(newFileFolderPath)) {
      newFileFolderPath = `${originalPath}Untitled ${++i}.${format}`;
    }
    const newFile = await this.app.vault.create(newFileFolderPath, content);
    return newFile;
  }

  // function to create the view
  cookViewCreator = (leaf: WorkspaceLeaf) => {
    return new CookView(leaf, this.settings, path => this.sessions.acquire(leaf, path),
      this.editAsMarkdown, this.recipeHost);
  }

  reloadCookViews() {
    this.alarms.setEnabled(this.settings.timersRing);
    this.app.workspace.getLeavesOfType('cook').forEach(leaf => {
      if(leaf.view instanceof CookView) {
        leaf.view.updateSettings(this.settings);
      }
    });
  }

  // A dish under a list of days, for meal plans.
  addMenuIcon = () => {
    addIcon('document-menu', `
    <svg viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M30 52C38.8366 52 46 44.8366 46 36H14C14 44.8366 21.1634 52 30 52Z" fill="currentColor"/>
    <rect x="12" y="8" width="36" height="5" rx="2.5" fill="currentColor"/>
    <rect x="12" y="18" width="36" height="5" rx="2.5" fill="currentColor"/>
    <rect x="12" y="28" width="24" height="5" rx="2.5" fill="currentColor"/>
    </svg>
    `);
  }

  // this function provides the icon for the document
  addDocumentIcon = (extension: string) => {
    addIcon(`document-${extension}`, `
    <svg viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M30 48C39.9411 48 48 39.9411 48 30H12C12 39.9411 20.0589 48 30 48Z" fill="currentColor"/>
    <circle cx="18" cy="18" r="4" fill="currentColor"/>
    <circle cx="42" cy="18" r="4" fill="currentColor"/>
    <circle cx="30" cy="16" r="4" fill="currentColor"/>
    </svg>
    `);
  }
}
