import { AbstractInputSuggest, App, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { RECIPE_FORMATS, type RecipeFormat } from './utils/recipeFiles';
import type { WeightTableStatus } from './services/WeightTableLoader';

declare class CookPlugin extends Plugin {
  settings: CooklangSettings;
  reloadCookViews(): void;
  reloadWeights(): Promise<WeightTableStatus | null>;
  weightsStatus(): WeightTableStatus | null;
}

const WEIGHTS_FILE_EXTENSIONS = ['yaml', 'yml'];

/** Suggests YAML files in the vault for the weights file setting. */
class YamlFileSuggest extends AbstractInputSuggest<TFile> {
  constructor(app: App, private inputEl: HTMLInputElement, private onPick: (path: string) => void) {
    super(app, inputEl);
  }

  getSuggestions(query: string): TFile[] {
    const needle = query.trim().toLowerCase();
    return this.app.vault.getFiles()
      .filter(file => WEIGHTS_FILE_EXTENSIONS.includes(file.extension) && file.path.toLowerCase().includes(needle))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, 50);
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.setText(file.path);
  }

  selectSuggestion(file: TFile): void {
    this.setValue(file.path);
    this.onPick(file.path);
    this.close();
  }
}

function describeWeightsStatus(status: WeightTableStatus | null): string {
  if (!status) return 'A YAML file in your vault mapping ingredients to grams_per_100ml.';
  const loaded = `${status.entries} ingredient name${status.entries === 1 ? '' : 's'} loaded from ${status.path}.`;
  return status.errors.length ? `${loaded} ${status.errors.join(' ')}` : loaded;
}

export class CooklangSettings {
  /** Internal marker used to show release notes only once per plugin version. */
  lastSeenVersion?: string;
  showImages: boolean = true;
  showIngredientList: boolean = true;
  showCookwareList: boolean = true;
  showTimersList: boolean = false;
  showTotalTime: boolean = true;
  showTimersInline: boolean = true;
  showQuantitiesInline: boolean = false;
  timersTick: boolean = true;
  timersRing: boolean = true;
  highlightIngredientCookware: boolean = false;
  groupIngredientsBySection: boolean = false;
  defaultView: 'source' | 'preview' = 'source';
  defaultRecipeFormat: RecipeFormat = 'cook';
  showServingsScaler: boolean = true;
  /** Vault path of the YAML table used for volume-to-weight conversion. */
  weightsFile: string = "";
  /** Show amounts as weights by default when the table can convert them. */
  preferWeight: boolean = false;
  twoColumnLayout: boolean = true;
  enableStepTracking: boolean = true;
  servingsLabel: string = "";
  metadataLabel: string = "";
  ingredientLabel: string = "";
  cookwareLabel: string = "";
  timersLabel: string = "";
  methodLabel: string = "";
  secondsLabel: string = "";
  minutesLabel: string = "";
  hoursLabel: string = "";
}

export class CookSettingsTab extends PluginSettingTab {
  plugin: CookPlugin;
  constructor(app: App, plugin: CookPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    let { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName('New recipe format')
      .setDesc('Markdown recipes support Obsidian properties, search, and note embeds. Existing files are unchanged.')
      .addDropdown(dropdown => dropdown
        .addOption('cook', '.cook')
        .addOption('cook.md', '.cook.md')
        .addOption('md', '.md with recipe: true')
        .setValue(this.plugin.settings.defaultRecipeFormat)
        .onChange(async value => {
          if (!RECIPE_FORMATS.includes(value as RecipeFormat)) return;
          this.plugin.settings.defaultRecipeFormat = value as RecipeFormat;
          await this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Preview Options')
      .setHeading();

    new Setting(containerEl)
      .setName('Default view')
      .setDesc('Which mode to show when a recipe opens in a new tab (e.g. selecting it in the file tree)')
      .addDropdown(dropdown => dropdown
        .addOption('source', 'Source (editor)')
        .addOption('preview', 'Preview')
        .setValue(this.plugin.settings.defaultView)
        .onChange((value: string) => {
          this.plugin.settings.defaultView = value === 'preview' ? 'preview' : 'source';
          this.plugin.saveData(this.plugin.settings);
        }));

    new Setting(containerEl)
      .setName('Show images')
      .setDesc('Show images in the recipe (see https://cooklang.org/docs/spec/#adding-pictures)')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showImages)
        .onChange((value: boolean) => {
          this.plugin.settings.showImages = value;
          this.plugin.saveData(this.plugin.settings);
          this.plugin.reloadCookViews();
        }));

    new Setting(containerEl)
      .setName('Show ingredient list')
      .setDesc('Show the list of ingredients at the top of the recipe')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showIngredientList)
        .onChange((value: boolean) => {
          this.plugin.settings.showIngredientList = value;
          this.plugin.saveData(this.plugin.settings);
          this.plugin.reloadCookViews();
        }));

    new Setting(containerEl)
      .setName('Group ingredients by section')
      .setDesc('List ingredients under each recipe section’s title (only affects recipes that use = Section headers)')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.groupIngredientsBySection)
        .onChange((value: boolean) => {
          this.plugin.settings.groupIngredientsBySection = value;
          this.plugin.saveData(this.plugin.settings);
          this.plugin.reloadCookViews();
        }));

    new Setting(containerEl)
      .setName('Highlight Ingredients & Cookware')
      .setDesc('Highlight ingredients and cookware in different colors in the method steps')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.highlightIngredientCookware)
        .onChange((value: boolean) => {
          this.plugin.settings.highlightIngredientCookware = value;
          this.plugin.saveData(this.plugin.settings);
          this.plugin.reloadCookViews();
        }));

    new Setting(containerEl)
      .setName('Servings scaler')
      .setDesc('Show a +/- control to rescale ingredient quantities by servings')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showServingsScaler)
        .onChange((value: boolean) => {
          this.plugin.settings.showServingsScaler = value;
          this.plugin.saveData(this.plugin.settings);
          this.plugin.reloadCookViews();
        }));

    const weightsSetting = new Setting(containerEl)
      .setName('Weights file')
      .setDesc(describeWeightsStatus(this.plugin.weightsStatus()));
    const applyWeightsFile = async (path: string) => {
      if (path === this.plugin.settings.weightsFile) return;
      this.plugin.settings.weightsFile = path;
      await this.plugin.saveData(this.plugin.settings);
      const status = await this.plugin.reloadWeights();
      if (this.plugin.settings.weightsFile === path) weightsSetting.setDesc(describeWeightsStatus(status));
    };
    weightsSetting.addSearch(search => {
      search
        .setPlaceholder('Kitchen/weights.yaml')
        .setValue(this.plugin.settings.weightsFile);
      new YamlFileSuggest(this.app, search.inputEl, path => { void applyWeightsFile(path); });
      // Typed paths apply on blur/enter so partial input doesn't reload on every keystroke.
      search.inputEl.addEventListener('change', () => { void applyWeightsFile(search.getValue().trim()); });
      search.onChange(value => { if (!value) void applyWeightsFile(''); });
    });

    new Setting(containerEl)
      .setName('Prefer weights')
      .setDesc('Show ingredient amounts in grams by default. The recipe preview has a volume/weight toggle; embeds follow this setting.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.preferWeight)
        .onChange((value: boolean) => {
          this.plugin.settings.preferWeight = value;
          this.plugin.saveData(this.plugin.settings);
          this.plugin.reloadCookViews();
        }));

    new Setting(containerEl)
      .setName('Two-column layout')
      .setDesc('Show ingredients beside the steps on wide panes (stacks on narrow panes)')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.twoColumnLayout)
        .onChange((value: boolean) => {
          this.plugin.settings.twoColumnLayout = value;
          this.plugin.saveData(this.plugin.settings);
          this.plugin.reloadCookViews();
        }));

    new Setting(containerEl)
      .setName('Step tracking')
      .setDesc('Tap a step to mark it current and dim completed steps')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableStepTracking)
        .onChange((value: boolean) => {
          this.plugin.settings.enableStepTracking = value;
          this.plugin.saveData(this.plugin.settings);
          this.plugin.reloadCookViews();
        }));

    new Setting(containerEl)
      .setName('Show cookware list')
      .setDesc('Show the list of cookware at the top of the recipe')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showCookwareList)
        .onChange((value: boolean) => {
          this.plugin.settings.showCookwareList = value;
          this.plugin.saveData(this.plugin.settings);
          this.plugin.reloadCookViews();
        }));

    new Setting(containerEl)
      .setName('Show quantities inline')
      .setDesc('Show the ingredient quantities inline in the recipe method')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showQuantitiesInline)
        .onChange((value: boolean) => {
          this.plugin.settings.showQuantitiesInline = value;
          this.plugin.saveData(this.plugin.settings);
          this.plugin.reloadCookViews();
        }));

    new Setting(containerEl)
      .setName('Show timers list')
      .setDesc('Show the list of timers at the top of the recipe')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showTimersList)
        .onChange((value: boolean) => {
          this.plugin.settings.showTimersList = value;
          this.plugin.saveData(this.plugin.settings);
          this.plugin.reloadCookViews();
        }));

    new Setting(containerEl)
      .setName('Inline interactive timers')
      .setDesc('Allow clicking on a time in a recipe method to start a timer')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showTimersInline)
        .onChange((value: boolean) => {
          this.plugin.settings.showTimersInline = value;
          this.plugin.saveData(this.plugin.settings);
          this.plugin.reloadCookViews();
        }));

    new Setting(containerEl)
      .setName('Show total time')
      .setDesc('Show the total of all timers at the top of the recipe')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showTotalTime)
        .onChange((value: boolean) => {
          this.plugin.settings.showTotalTime = value;
          this.plugin.saveData(this.plugin.settings);
          this.plugin.reloadCookViews();
        }));

    new Setting(containerEl)
      .setName('Running Timers Tick')
      .setDesc('Play a ticking sound while a timer is running')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.timersTick)
        .onChange((value: boolean) => {
          this.plugin.settings.timersTick = value;
          this.plugin.saveData(this.plugin.settings);
          this.plugin.reloadCookViews();
        }));

    new Setting(containerEl)
      .setName('Alarm When Timers End')
      .setDesc('Ring until all finished timer notifications are dismissed. Notifications remain visible when sound is off.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.timersRing)
        .onChange((value: boolean) => {
          this.plugin.settings.timersRing = value;
          this.plugin.saveData(this.plugin.settings);
          this.plugin.reloadCookViews();
        }));

    new Setting(containerEl)
      .setName('Custom Labels')
      .setHeading();

    new Setting(containerEl)
      .setName("Metadata Label")
      .setDesc("Choose your label for the metadata")
      .addText((text) => text
      .setValue(this.plugin.settings.metadataLabel)
      .setPlaceholder("Metadata")
      .onChange(async (value) => {
        this.plugin.settings.metadataLabel = value;
        this.plugin.saveData(this.plugin.settings);
        this.plugin.reloadCookViews();
      }));
        
    new Setting(containerEl)
      .setName("Ingredient Label")
      .setDesc("Choose your label for the ingredients")
      .addText((text) => text
      .setValue(this.plugin.settings.ingredientLabel)
      .setPlaceholder("Ingredients")
      .onChange(async (value) => {
        this.plugin.settings.ingredientLabel = value;
        this.plugin.saveData(this.plugin.settings);
        this.plugin.reloadCookViews();
      }));

    new Setting(containerEl)
      .setName("Servings Label")
      .setDesc("Choose your label for servings")
      .addText((text) => text
      .setValue(this.plugin.settings.servingsLabel)
      .setPlaceholder("servings")
      .onChange(async (value) => {
        this.plugin.settings.servingsLabel = value;
        this.plugin.saveData(this.plugin.settings);
        this.plugin.reloadCookViews();
      }));

    new Setting(containerEl)
      .setName("Cookware Label")
      .setDesc("Choose your label for cookware")
      .addText((text) =>
      text
      .setValue(this.plugin.settings.cookwareLabel)
      .setPlaceholder("Cookware")
      .onChange(async (value) => {
        this.plugin.settings.cookwareLabel = value;
        this.plugin.saveData(this.plugin.settings);
        this.plugin.reloadCookViews();
      }));

    new Setting(containerEl)
      .setName("Timer Label")
      .setDesc("Choose your label for timers")
      .addText((text) => text
      .setValue(this.plugin.settings.timersLabel)
      .setPlaceholder("Timers")
      .onChange(async (value) => {
        this.plugin.settings.timersLabel = value;
        this.plugin.saveData(this.plugin.settings);
        this.plugin.reloadCookViews();
      }));

    new Setting(containerEl)
      .setName("Method Label")
      .setDesc("Choose your label for the cooking method")
      .addText((text) => text
      .setValue(this.plugin.settings.methodLabel)
      .setPlaceholder("Method")
      .onChange(async (value) => {
        this.plugin.settings.methodLabel = value;
        this.plugin.saveData(this.plugin.settings);
        this.plugin.reloadCookViews();
      }));

    new Setting(containerEl)
      .setName("Seconds Label")
      .setDesc("Choose your label(s) for seconds (comma separated)")
      .addText((text) => text
      .setValue(this.plugin.settings.secondsLabel)
      .setPlaceholder("s,sec,secs,second,seconds")
      .onChange(async (value) => {
        this.plugin.settings.secondsLabel = value;
        this.plugin.saveData(this.plugin.settings);
        this.plugin.reloadCookViews();
      }));

    new Setting(containerEl)
      .setName("Minutes Label")
      .setDesc("Choose your label(s) for minutes (comma separated)")
      .addText((text) => text
      .setValue(this.plugin.settings.minutesLabel)
      .setPlaceholder("m,min,mins,minute,minutes")
      .onChange(async (value) => {
        this.plugin.settings.minutesLabel = value;
        this.plugin.saveData(this.plugin.settings);
        this.plugin.reloadCookViews();
      }));

    new Setting(containerEl)
      .setName("Hours Label")
      .setDesc("Choose your label(s) for hours (comma separated)")
      .addText((text) => text
      .setValue(this.plugin.settings.hoursLabel)
      .setPlaceholder("h,hr,hrs,hour,hours")
      .onChange(async (value) => {
        this.plugin.settings.hoursLabel = value;
        this.plugin.saveData(this.plugin.settings);
        this.plugin.reloadCookViews();
      }));
  }
}
