import { Disposable, ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri, workspace as Workspace } from 'vscode';
import { parse as YamlParse } from 'yaml';
import { WadTreeItem, WadTreeItemOptions } from './treeItem';
import { basename as Basename, dirname as Dirname, join as Join } from 'path';
import { v4 } from 'uuid';
import { ScmUtils } from './scmUtils';
import { getIconUri, toProperCase, regExObj, camelCase } from './util';
import { TValidScm } from './Scm';
import { dispose } from './msutil';

type DirectiveType = 'package-as' | 'externals' | 'move-folders' | 'ignore' | 'required-dependencies' | 'optional-dependencies' | 'manual-changelog' | 'license-output' | 'embedded-libraries' | 'tools-used' | 'enable-nolib-creation';
type ArrayOfStringsDirective = 'ignore' | 'required-dependencies' | 'optional-dependencies' | 'embedded-libraries' | 'tools-used';
type DirectiveChildren = ExternalsChild | MoveFoldersChild | ArrayOfStringsChild;
type DirectiveProps = ExtDirChildOpt | MoveFoldersChildOpt | PkgAsRootOpt | EnableNoLibOpt | ManualChangeLogOpt | ArrayOfStringsOpt;

interface PkgAsRootOpt {
  name: string
}

interface EnableNoLibOpt {
  status: string
}

export interface ExtDirChildOpt {
  targetUri: Uri,
  targetDir: string;
  url: string;
  type: TValidScm;
  tag?: string;
  branch?: string;
  commit?: string;
}

interface ArrayOfStringsOpt {
  pattern: string
}

interface MoveFoldersChildOpt {
  sourceDir: string;
  targetDir: string;
}

interface ManualChangeLogOpt {
  filename: string,
  'markup-type': string
}

abstract class RootBaseDirective {
  children: DirectiveChildren[] = [];
  directiveProps: DirectiveProps | undefined;
  parentOrChild: 'parent' | 'child' = 'parent';
  root: boolean = false;

  get id() {
    return this.uuid;
  }

  get label() {
    return toProperCase(this.directiveType.replace(/-/g, ' '));
  }

  get fileType() {
    return 'pkgmeta';
  }

  get collapsibleState(): TreeItemCollapsibleState {
    return this.children.length > 0 ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None;
  }

  get contextValue() {
    return `${camelCase(this.directiveType.replace(/-/gm, ''))}${toProperCase(this.parentOrChild)}`;
  }

  abstract uuid: string;
  abstract directiveType: DirectiveType;
  abstract iconPath: TreeItem['iconPath'];
  abstract description: string | undefined;

  get treeItem() {
    return new WadTreeItem({
      id: this.uuid,
      label: this.label,
      fileType: this.fileType,
      iconPath: this.iconPath,
      description: this.description,
      collapsibleState: this.collapsibleState,
      contextValue: this.contextValue,
      children: this.children,
    });
  }
}

export class ExternalsChild extends RootBaseDirective {
  directiveProps: ExtDirChildOpt;
  directiveType: DirectiveType = 'externals';
  installDir: Uri;
  pkgMetaFile: PkgmetaFile
  uuid: string;

  get tooltip() {
    return this.directiveProps.url;
  }
  get collapsibleState() {
    return TreeItemCollapsibleState.None;
  }

  get contextValue(): string {
    return 'pkgMetaExternal';
  }
  get description() {
    return toProperCase(this.directiveProps.type);
  }

  get iconPath() {
    return this.directiveProps.type === 'svn' ? getIconUri('svn-repo', 'dark') : new ThemeIcon('git-branch');
  }

  get label() {
    return this.directiveProps.targetDir;
  }
  constructor(
    options: ExtDirChildOpt,
    pkgMetaFile: PkgmetaFile
  ) {
    super()
    this.pkgMetaFile = pkgMetaFile;
    this.parentOrChild = 'child';
    this.uuid = v4();
    this.directiveProps = options;
    this.installDir = Uri.parse('');
  }
}

export class ExternalsRoot extends RootBaseDirective {
  directiveType: DirectiveType = 'externals';
  children: ExternalsChild[] = [];
  uuid: string;
  libUri: Uri;

  addChild(options: ExtDirChildOpt) {
    return new ExternalsChild(options, this.pkgMetaFile);
  }

  addChildren(options: ExtDirChildOpt[]) {
    return options.map(option => this.addChild(option));
  }

  get collapsibleState() {
    return this.children.length > 0 ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None;
  }

  get childrenTreeItems() {
    return this.children.map(child => child.treeItem);
  }

  get description() {
    return this.children.length.toString();
  }

  get iconPath() {
    return new ThemeIcon('cloud-download');
  }
  pkgMetaFile: PkgmetaFile
  constructor(
    libUri: Uri,
    pkgMetaFile: PkgmetaFile,
    children?: ExtDirChildOpt[]
  ) {
    super();
    this.uuid = v4();
    this.libUri = libUri;
    this.pkgMetaFile = pkgMetaFile
    if (children) {
      this.children = this.addChildren(children!);
    }
  }
}

class MoveFoldersChild extends RootBaseDirective {
  directiveType: DirectiveType = 'move-folders';
  directiveProps: MoveFoldersChildOpt;
  uuid: string;

  get collapsibleState() {
    return TreeItemCollapsibleState.None;
  }

  get description() {
    return this.directiveProps.targetDir;
  }

  get iconPath() {
    return new ThemeIcon('triangle-right');
  }

  get label() {
    return this.directiveProps.sourceDir;
  }

  constructor(options: MoveFoldersChildOpt) {
    super();
    this.uuid = v4();
    this.directiveProps = options;
    this.parentOrChild = 'child';
  }
}

class MoveFoldersRoot extends RootBaseDirective {
  directiveType: DirectiveType = 'move-folders';
  children: MoveFoldersChild[] = [];
  uuid: string;

  addChild(options: MoveFoldersChildOpt) {
    return this.children.push(new MoveFoldersChild(options));
  }

  addChildren(options: MoveFoldersChildOpt[]) {
    return options.map(option => this.addChild(option));
  }

  get collapsibleState() {
    return this.children.length > 0 ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None;
  }

  get childrenTreeItems() {
    return this.children.map(child => child.treeItem);
  }

  get description() {
    return this.children.length.toString();
  }

  get iconPath() {
    return new ThemeIcon('move');
  }

  constructor(
    children?: MoveFoldersChildOpt[]
  ) {
    super();
    this.uuid = v4();
    this.addChildren(children!);
  }
}

class PackageAsRoot extends RootBaseDirective {
  directiveType: DirectiveType = 'package-as';
  directiveProps: PkgAsRootOpt;
  uuid: string;

  get description() {
    return this.directiveProps.name;
  }

  get iconPath() {
    return new ThemeIcon('package');
  }

  constructor(
    name: string
  ) {
    super();
    this.uuid = v4();
    this.directiveProps = {
      name
    };
  }
}

class EnableNolibCreationRoot extends RootBaseDirective {
  directiveType: DirectiveType = 'enable-nolib-creation';
  directiveProps: EnableNoLibOpt;
  uuid: string;

  get description() {
    return this.directiveProps.status;
  }

  get iconPath() {
    return new ThemeIcon('package');
  }

  constructor(
    status: string
  ) {
    super();
    this.uuid = v4();
    this.directiveProps = {
      status
    };
  }
}

class LicenseOutputRoot extends RootBaseDirective {
  directiveType: DirectiveType = 'license-output';
  directiveProps: { name: string };
  uuid: string;

  get description() {
    return this.directiveProps.name;
  }

  get iconPath() {
    return new ThemeIcon('package');
  }

  constructor(
    name: string
  ) {
    super();
    this.uuid = v4();
    this.directiveProps = {
      name
    };
  }
}

class ManualChangelogRoot extends RootBaseDirective {
  directiveType: DirectiveType = 'manual-changelog';
  directiveProps: ManualChangeLogOpt;
  uuid: string;

  get description() {
    return this.directiveProps.filename;
  }

  get iconPath() {
    return new ThemeIcon('package');
  }

  constructor(
    options: ManualChangeLogOpt
  ) {
    super();
    this.uuid = v4();
    this.directiveProps = options;
  }
}

class ArrayOfStringsChild extends RootBaseDirective {
  directiveType: ArrayOfStringsDirective;
  directiveProps: ArrayOfStringsOpt;
  uuid: string;

  get collapsibleState() {
    return TreeItemCollapsibleState.None;
  }

  get description() {
    return undefined;
  }

  get iconPath() {
    const iconObject = {
      'ignore': 'stop',
      'required-dependencies': 'tools',
      'optional-dependencies': 'tools',
      'embedded-libraries': 'tools',
      'tools-used': 'tools',
    };
    return new ThemeIcon(iconObject[this.directiveType]);
  }

  get label() {
    return this.directiveProps.pattern;
  }

  constructor(options: ArrayOfStringsOpt, directiveType: ArrayOfStringsDirective) {
    super();
    this.parentOrChild = 'parent';
    this.uuid = v4();
    this.directiveProps = options;
    this.directiveType = directiveType;
  }
}

class ArrayOfStringsRoot extends RootBaseDirective {
  directiveType: ArrayOfStringsDirective;
  children: ArrayOfStringsChild[] = [];
  uuid: string;

  addChild(options: ArrayOfStringsOpt) {
    return this.children.push(new ArrayOfStringsChild(options, this.directiveType));
  }

  addChildren(options: ArrayOfStringsOpt[]) {
    return options.map(option => this.addChild(option));
  }

  get collapsibleState() {
    return this.children.length > 0 ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None;
  }

  get childrenTreeItems() {
    return this.children.map(child => child.treeItem);
  }

  get description() {
    return this.children.length.toString();
  }

  get iconPath() {
    return new ThemeIcon('gear');
  }

  constructor(
    directiveType: ArrayOfStringsDirective,
    children?: ArrayOfStringsOpt[],
  ) {
    super();
    this.uuid = v4();
    this.directiveType = directiveType;
    this.addChildren(children!);
  }
}

type RootDirectives = ExternalsRoot | MoveFoldersRoot | PackageAsRoot | EnableNolibCreationRoot | LicenseOutputRoot | ManualChangelogRoot | ArrayOfStringsRoot;

const directivesShown = [
  //'package-as',
  'externals',
  'move-folders',
  'ignore',
  'required-dependencies',
  'optional-dependencies',
  'manual-changelog',
  'license-output',
  'embedded-libraries',
  'tools-used',
  //'enable-nolib-creation'
];

type Directives = {
  [Key in DirectiveType as string]?: RootDirectives;
};

export class PkgmetaFile {

  private _directives: Directives = {};

  get directives() {
    return this._directives;
  }

  private yamlReviver(key: unknown, value: any, libUri: Uri) {
    const typedKey = key as string;
    if (!['package-as', 'externals', 'move-folders', 'ignore', 'required-dependencies',
      'optional-dependencies', 'manual-changelog', 'license-output', 'embedded-libraries',
      'tools-used', 'enable-nolib-creation'].includes(typedKey)) {
      return value;
    }

    if (typedKey === 'package-as' || typedKey === 'enable-nolib-creation' || typedKey === 'license-output') {
      return typedKey === 'package-as' ? new PackageAsRoot(value) : typedKey === 'enable-nolib-creation' ? new EnableNolibCreationRoot(value) : typedKey === 'license-output' ? new LicenseOutputRoot(value) : '';
    }

    if (typedKey === 'manual-changelog') {
      const filename = typeof (value) === 'string' ? value : value.filename;
      const type = typeof (value) === 'string' ? 'text' : value['markup-type'];
      return new ManualChangelogRoot({ filename: filename, 'markup-type': type });
    }

    if (typedKey === 'move-folders') {
      let rtnVal = new MoveFoldersRoot(Object.keys(value).map(v => { return { sourceDir: v, targetDir: value[v] }; }));
      return rtnVal;
    }

    if (typedKey === 'ignore' || typedKey === 'required-dependencies' || typedKey === 'optional-dependencies' || typedKey === 'embedded-libraries' || typedKey === 'tools-used') {
      const rtnVa1 = new ArrayOfStringsRoot(typedKey, value.map((v: string) => { return { pattern: v }; }));
      return rtnVa1;
    }

    if (typedKey === 'externals') {
      let children: ExtDirChildOpt[] = [];
      let property: keyof typeof value;
      for (property in value) {
        const oldExt = value[property];

        let externalRoot: ExtDirChildOpt = {
          targetDir: property,
          targetUri: Uri.joinPath(Uri.file(Dirname(this.resourceUri.fsPath)), property),
          type: 'git',
          ...typeof (oldExt) === 'string' ? { url: oldExt } : oldExt
        };

        const checkForOldReps = regExObj.oldReposRegex.exec(externalRoot.url)?.groups;
        if (checkForOldReps && checkForOldReps.path && checkForOldReps.type) {
          externalRoot.url = `https://repo${checkForOldReps.path}${checkForOldReps.end ? checkForOldReps.end : ''}`;
          externalRoot.type = checkForOldReps.type as TValidScm;
        } else {
          if (externalRoot.url.match(regExObj.svnCheckRegex)) { externalRoot.type = 'svn'; }
        }
        children.push(externalRoot);
      }

      return new ExternalsRoot(libUri, this, children);
    }
  }

  pkgMetaType: string = '';
  public initialized: Promise<boolean>;

  get title(): string {
    const rtnValue = this._directives['package-as'];
    if (typeof (rtnValue) === 'undefined') {
      return Basename(Dirname(this.resourceUri.fsPath));
    }
    return rtnValue.description;
  }

  private get treeItemEntries(): WadTreeItem[] {
    return Object.keys(this._directives).filter(d => directivesShown.includes(d)).map(directiveProp => {
      const rtnValue = this._directives[directiveProp]!;
      return rtnValue.treeItem;
    });
  }

  treeItem: WadTreeItem

  get workspaceRelativePath() {
    return this.resourceUri.fsPath.replace(Workspace.getWorkspaceFolder(this.resourceUri)!.uri.fsPath, '');
  }

  get filename() {
    return Basename(this.resourceUri.fsPath);
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

  public async libUri() {
    let potentialFolders = ['/Library', '/Libs', '/Lib'];
    let idx = 0;
    let externalsFolder: string = '';
    if (this._directives['externals']) {
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
    const libUri = await this.libUri();
    const tocFile = await this.tocFile();
    this._directives = YamlParse(pkgmetaFileString, { reviver: (key, value: any) => this.yamlReviver(key, value, libUri) });
    this.treeItem = new WadTreeItem({
      fileType: 'pkgmeta',
      label: this.title,
      children: this.treeItemEntries,
      description: this.filename,
      uri: this.resourceUri,
      tooltip: this.resourceUri.fsPath,
      iconPath: getIconUri(`${/(.+-bcc)|(.+-classic)/.test(this.filename) ? 'wowc' : 'wow'}`, 'dark'),
    })
    return true;
  }

  disposables: Disposable[] = []
  dispose(): void {
    this.disposables = dispose(this.disposables);
	}

  constructor(
    public resourceUri: Uri,
  ) {
    this.treeItem = new WadTreeItem({
      fileType: 'pkgmeta',
      label: this.title,
      children: this.treeItemEntries,
      description: undefined,
      uri: this.resourceUri,
      tooltip: this.resourceUri.fsPath,
      iconPath: getIconUri(`${/(.+-bcc)|(.+-classic)/.test(this.filename) ? 'wowc' : 'wow'}`, 'dark'),
    })
    this.initialized = this._initialize();
  }
}