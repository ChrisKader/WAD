import { ThemeIcon, TreeItemCollapsibleState, Uri, workspace as Workspace } from 'vscode';
import { parse as YamlParse } from 'yaml';
import { WadTreeItem, WadTreeItemOptions } from './treeItem';
import { basename as Basename, dirname as Dirname, join as Join } from 'path';
import { log } from './msutil';
import { ScmUtils } from './scmUtils';
import { getIconUri, toProperCase, regExObj } from "./util";

export interface ApiTokens {
  curseforge?: string,
  wowinterface?: string,
  wago?: string,
  github?: string,
}

interface PackagerOptions {
  createNoLib?: boolean;           // -s               Create a stripped-down "nolib" package.
  curseId?: string;                // -p curse-id      Set the project id used on CurseForge for localization and uploading. (Use 0 to unset the TOC value)
  gameVersion?: string;            // -g game-version  Set the game version to use for uploading.
  keepExistingPackageDir?: boolean;// -o               Keep existing package directory, overwriting its contents.
  pgkMetaFile?: string;            // -m pkgmeta.yaml  Set the pkgmeta file to use.
  releaseDirectory?: string;       // -r releasedir    Set directory containing the package directory. Defaults to "$topdir/.release".
  skipCopy?: boolean;              // -c               Skip copying files into the package directory.
  skipExternalCheckout?: boolean;  // -e               Skip checkout of external repositories.
  skipLocalization?: boolean;      // -l               Skip @localization@ keyword replacement.
  skipLocalizationUpload?: boolean;// -L               Only do @localization@ keyword replacement (skip upload to CurseForge).
  skipUpload?: boolean;            // -d               Skip uploading.
  skipZip?: boolean;               // -z               Skip zip file creation.
  topLevelDirectory?: string;      // -t topdir        Set top-level directory of checkout.
  unixLineEndings?: boolean;       // -u               Use Unix line-endings.
  wagoId?: string;                 // -a wago-id       Set the project id used on Wago Addons for uploading. (Use 0 to unset the TOC value)
  wowInterfaceId?: string;         // -w wowi-id       Set the addon id used on WoWInterface for uploading. (Use 0 to unset the TOC value)
  zipFileName?: string;            // -n "{template}"  Set the package zip file name and upload label. Use "-n help" for more info. */
  labelTemplate?: string;
  tokens?: ApiTokens;
}

interface PkgMetaExternal {
  url: string;
  type: string;
  tag?: string;
  branch?: string;
  commit?: string;
}

interface KeyedPkgMetaExternal {
  [key: string]: PkgMetaExternal
}

interface PkgMetaMoveFolders {
  [key: string]: string
}

interface PkgMetaManualChangelog {
  filename: string;
  "markup-type": string;
}

type DirectiveTypes = string | string[] | KeyedPkgMetaExternal | PkgMetaMoveFolders[] | PkgMetaManualChangelog | undefined;

class External {
  public url: string;
  public type: string;
  public tag?: string;
  public branch?: string;
  public commit?: string;

  get iconPath(){
    return this.type === 'svn' ? getIconUri('svn-repo','dark') : new ThemeIcon('git-branch')
  }
  get treeItemOptions(): WadTreeItemOptions{
    return {
      label: this.destination,
      description: this.type,
      type: 'pkgmeta',
      tooltip: this.url,
      iconPath: this.iconPath
    };
  }

  constructor(
    public destination: string,
    options: PkgMetaExternal,
  ){
    this.url = options.url;
    this.type = options.type;
    this.tag = options.tag;
    this.branch = options.branch;
    this.commit = options.commit;
  }
}
type ArrayDirectives = 'ignore' | 'required-dependencies' | 'optional-dependencies' | 'embedded-libraries' | 'tools-used';

class StringArray {
  get iconPath(){
    const iconObject: { [key: string]: string } = {
      'ignore': 'stop',
      'required-dependencies': 'tools',
      'optional-dependencies': 'tools',
      'embedded-libraries': 'tools',
      'tools-used': 'tools',
    };
    return new ThemeIcon(iconObject[this.type]);
  }

  get treeItemOptions(): WadTreeItemOptions{
    return {
      label: this.item,
      type: 'pkgmeta',
      iconPath: this.iconPath
    };
  }

  constructor(
    public type: ArrayDirectives,
    public item: string
  ){
    this.type = type;
  }
}

export class PkgmetaFile {
  private _directives: {
    [key: string]: DirectiveTypes
    "package-as": string;
    "externals"?: KeyedPkgMetaExternal;
    "move-folders"?: PkgMetaMoveFolders[];
    "ignore"?: string[];
    "required-dependencies"?: string[];
    "optional-dependencies"?: string[];
    "manual-changelog"?: PkgMetaManualChangelog;
    "license-output"?: string;
    "embdded-libraries"?: string[];
    "tools-used"?: string[];
    "enable-nolib-creation"?: string;
  } = {
      "package-as": "Loading"
    };

  get directives() {
    return this._directives;
  }

  private yamlReviver(key: unknown, value: any) {
    const typedKey = <string>key;
    if (!["package-as", "externals", "move-folders", "ignore", "required-dependencies",
      "optional-dependencies", "manual-changelog", "license-output", "embdded-libraries",
      "tools-used", "enable-nolib-creation"].includes(typedKey)) {
      return value;
    }

    if (typedKey === 'package-as' || typedKey === 'enable-nolib-creation' || typedKey === 'license-output') {
      return <string>value;
    }

    if (typedKey === 'manual-changelog') {
      const rtnValue: PkgMetaManualChangelog = typeof (value) === 'string' ? Object.assign({}, { filename: value }, { 'markup-type': 'text' }) : Object.assign({}, { 'markup-type': 'text' }, value);
      return rtnValue;
    }

    if (typedKey === 'move-folders') {
      const rtnValue: PkgMetaMoveFolders = value;
      return rtnValue;
    }

    if (typedKey === 'ignore' || typedKey === 'required-dependencies' || typedKey === 'optional-dependencies' || typedKey === 'embedded-libraries' || typedKey === 'tools-used') {
      return value.map((v:string)=>{
        return new StringArray(typedKey,v);
      });
    }

    if (typedKey === 'externals') {
      let externals: External[] = [];
      let property: keyof typeof value;
      for (property in value) {
        const external: PkgMetaExternal = typeof (value[property]) === 'string' ? Object.assign({}, { url: value[property], type: 'git' }) : <PkgMetaExternal>Object.assign({}, <PkgMetaExternal>value[property]);
        const checkForOldReps = regExObj.oldReposRegex.exec(external.url)?.groups;
        if (checkForOldReps && checkForOldReps.path && checkForOldReps.type) {
          external.url = `https://repo${checkForOldReps.path}${checkForOldReps.end ? checkForOldReps.end : ''}`;
          external.type = checkForOldReps.type;
        } else {
          if (external.url.match(regExObj.svnCheckRegex)) {
            external.type = 'svn';
          } else {
            external.type = 'git';
          }
        }
        externals.push(new External(property,external));
      }
      return externals;
    }
  }

  pkgMetaType: string = '';
  public initialized: Promise<boolean>;

  get title(): string {
    return this._directives['package-as'];
  }

  private generateTreePropertyChildren(source: DirectiveTypes, directiveType: string): WadTreeItemOptions[] {
    let autoProps = ['iconPath', 'uri', 'label', 'description', 'command', 'contextValue'];
    const sourceArr: string[] = directiveType === 'move-folders' ? Object.keys(Object(source)) : <string[]>source;

    const iconObject: { [key: string]: string } = {
      'externals': 'cloud-download',
      'manual-changelog': 'request-changes',
      'ignore': 'stop',
      'required-dependencies': 'tools',
      'optional-dependencies': 'tools',
      'embedded-libraries': 'tools',
      'tools-used': 'tools',
    };
    return sourceArr.map(sourceString => {
      let autoPropHolder: WadTreeItemOptions = {
        iconPath: undefined,
        command: undefined,
        description: undefined,
        contextValue: undefined,
        label: sourceString,
        type: 'pkgmeta',
        uri: undefined,
      };

      for (let idx = 0; idx < autoProps.length; idx++) {
        const autoProp = autoProps[idx];
        if (autoProp === 'label') {
          if (directiveType === 'move-folders') {
            autoPropHolder[autoProp] = `${sourceString} →`;
          }
        }
        if (autoProp === 'description') {
          if (directiveType === 'move-folders') {
            autoPropHolder[autoProp] = Object(source)[sourceString];
          }
        } else if (autoProp === 'iconPath' && iconObject[directiveType]) {
          autoPropHolder[autoProp] = new ThemeIcon(iconObject[directiveType]);
        } else if (['resourceUri', 'uri'].includes(autoProp)) {
          autoPropHolder[autoProp] = undefined;
        } else if (['command', 'contextValue'].includes(autoProp)) {
          autoPropHolder[autoProp] = undefined;
        }
      }
      return autoPropHolder;
    });
  }

  private generateTreeProperty(source: DirectiveTypes, directiveType: string, child?: boolean): WadTreeItemOptions {
    let autoProps = ['label', 'type', 'iconPath', 'description', 'resourceUri', 'uri', 'tooltip', 'command', 'collapsibleState', 'contextValue', 'children'];

    let autoPropHolder: WadTreeItemOptions = {
      iconPath: undefined,
      description: undefined,
      resourceUri: undefined,
      tooltip: undefined,
      command: undefined,
      collapsibleState: undefined,
      contextValue: undefined,
      label: '',
      type: 'pkgmeta',
      children: undefined,
      uri: undefined,
    };

    for (let idx = 0; idx < autoProps.length; idx++) {
      const autoProp = autoProps[idx];
      if (autoProp === 'children') {
        if (['ignore', 'move-folders', 'required-dependencies', 'optional-dependencies', 'embedded-libraries', 'tools-used'].includes(directiveType)) {
          const arr: string[] = <string[]>source;
          autoPropHolder[autoProp] = this.generateTreePropertyChildren(source, directiveType).map(v => {
            return new WadTreeItem(v);
          });
        }
        /* if(directiveType === ('ignore' || 'required-dependencies' || 'optional-dependencies' || 'embedded-libraries' || 'tools-used')){
          autoPropValue = [];
        } else {
          autoPropValue = [];
        } */
      } else if (autoProp === 'label') {
        autoPropHolder[autoProp] = toProperCase(directiveType.replace(/-/g, ' '));
      } else if (autoProp === 'description') {
        if (directiveType === 'manual-changelog') {
          const changelog = <PkgMetaManualChangelog>source;
          autoPropHolder[autoProp] = changelog.filename;
        } else {
          autoPropHolder[autoProp] = Object.keys(source!).length.toString();
        }
      } else if (autoProp === 'iconPath') {
        const iconObject: { [key: string]: string } = {
          'externals': 'cloud-download',
          'manual-changelog': 'request-changes',
          'ignore': 'diff-ignored',
          'move-folders': 'move',
          'required-dependencies': 'tools',
          'optional-dependencies': 'tools',
          'embedded-libraries': 'tools',
          'tools-used': 'tools',
        };
        autoPropHolder[autoProp] = new ThemeIcon(iconObject[directiveType]);
      } else if (['resourceUri', 'uri'].includes(autoProp)) {
        autoPropHolder[autoProp] = undefined;
      } else if (autoProp === 'tooltip') {
        if (directiveType === 'manual-changelog') {
          const changelog = <PkgMetaManualChangelog>source;
          autoPropHolder[autoProp] = changelog['markup-type'];
        } else {
          autoPropHolder[autoProp] = undefined;
        }
      } else if (autoProp === 'collapsibleState') {
        if (['externals', 'ignore', 'move-folders', 'required-dependencies', 'optional-dependencies', 'embedded-libraries', 'tools-used'].includes(directiveType)) {
          if ((Array.isArray(source) || Object.getOwnPropertyNames(source).length > 1)) {
            autoPropHolder[autoProp] = TreeItemCollapsibleState.Collapsed;
          } else {
            autoPropHolder[autoProp] = TreeItemCollapsibleState.None;
          }
        } else {
          autoPropHolder[autoProp] = TreeItemCollapsibleState.None;
        }
      } else if (['command', 'contextValue'].includes(autoProp)) {
        autoPropHolder[autoProp] = undefined;
      } else if (autoProp === 'root') {
        autoPropHolder[autoProp] = false;
      } else if (autoProp === 'type') {
        autoPropHolder[autoProp] = 'pkgmeta';
      }
    }
    return autoPropHolder;
  }

  private get treeItemEntries(): WadTreeItem[] {
    return Object.keys(this._directives).filter(k => {
      if (k === 'enable-nolib-creation' || k === 'package-as') {
        return false;
      }
      return true;
    }).map(directiveProp => {
      return new WadTreeItem(this.generateTreeProperty(this._directives[directiveProp], directiveProp));
    });
  }

  get workspaceRelativePath() {
    return this.resourceUri.fsPath.replace(Workspace.getWorkspaceFolder(this.resourceUri)!.uri.fsPath, '');
  }

  get filename() {
    return Basename(this.resourceUri.fsPath);
  }

  get treeItem(): WadTreeItem {
    let wadItemTreeOptions: WadTreeItemOptions = {
      type: 'pkgmeta',
      label: this.title,
      children: this.treeItemEntries,
      description: this.filename,
      uri: this.resourceUri,
      tooltip: this.resourceUri.fsPath,
      iconPath: getIconUri(`${/(.+-bcc)|(.+-classic)/.test(this.filename) ? 'wowc' : 'wow'}`, 'dark'),
    };
    return new WadTreeItem(wadItemTreeOptions);
  }

  async tocFile() {
    let baseDir = Workspace.workspaceFolders![0].uri;

    const possiblePaths = [
      `/${this.title}.toc`,
      `${this.title}/${this.title}.toc`
    ];

    let idx = 0;
    while (idx < possiblePaths.length) {
      const possiblePath = possiblePaths[idx];
      const possibleUri = Uri.joinPath(baseDir, possiblePath);
      try {
        const tocFileStat = (await Workspace.fs.stat(possibleUri));
        if (typeof (tocFileStat) !== 'undefined') {
          return possibleUri;
        }
      } catch (e) {

      }
      idx++;
    }
    return false;
  }

  async libFolder() {
    let potentialFolders = ['/Library', '/Libs', '/Lib'];
    let idx = 0;
    let externalsFolder: string = '';
    if (this._directives["externals"]) {
      const destDir = ''; //<string><unknown>this._directives.externals[0][0].toString().split('/');
      if (destDir.length > 1) {
        externalsFolder = destDir[destDir.length - 2];
        potentialFolders = [externalsFolder, ...potentialFolders];
      }
    }
    while (idx < potentialFolders.length) {
      const potentialFolder = potentialFolders[idx];
      const testUri = Uri.joinPath(this.resourceUri, potentialFolder);
      try {
        const checkDir = (await Workspace.fs.stat(testUri));
        if (typeof (checkDir) !== 'undefined') {
          return testUri;
        }
      } catch (e) {

      }
      idx++;
    }

    const configDir = Workspace.getConfiguration('wad').get('defaultLibFolder', '/Libs');
    return Uri.joinPath(this.resourceUri.with({ path: Dirname(this.resourceUri.fsPath) }), '/', this.title, externalsFolder.length > 0 ? externalsFolder : configDir);
  }
  smcUtils = new ScmUtils();
  private async _initialize(): Promise<boolean> {
    const pkgmetaFileString = (await Workspace.fs.readFile(this.resourceUri)).toString();
    this.pkgMetaType = this.resourceUri.toString().indexOf('.yaml') > -1 ? 'yaml' : 'dot';
    this._directives = YamlParse(pkgmetaFileString, { reviver: (key, value: any) => this.yamlReviver(key, value) });
    return true;
  }

  constructor(
    public resourceUri: Uri,
  ) {
    this.initialized = this._initialize();
  }
}