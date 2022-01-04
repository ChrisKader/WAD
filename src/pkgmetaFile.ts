import { ThemeIcon, TreeItemCollapsibleState, Uri, workspace as Workspace } from 'vscode';
import { parse as YamlParse } from 'yaml';
import { WadTreeItem, WadTreeItemOptions } from './treeItem';
import { basename as Basename, dirname as Dirname, join as Join } from 'path';
import { log } from './msUtil';
import { ScmUtils } from './scmUtils';

export interface ApiTokens {
  curseforge?: string,
  wowinterface?: string,
  wago?: string,
  github?: string,
}

export interface PackagerOptions {
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

class EpocTime {
  _date: Date;
  public getTime() {
    return this._date.getTime() / 1000;
  }
  constructor(
    timestamp?: number
  ) {
    if (timestamp) {
      this._date = new Date(timestamp * 1000);
    } else {
      this._date = new Date();
    }
  }
}


interface PkgMetaExternal {
  [key: string]: {
    url: string;
    tag?: number | string;
    branch?: string;
    commit?: string;
    type?: string;
  }
}

interface PkgMetaMoveFolders {
  [key: string]: string
}

interface PkgMetaManualChangelog {
  filename: string;
  "markup-type": string;
}

function toProperCase(s: string) {
  return s.replace(/\w\S*/g, function(txt){return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();});
};
const regExObj = {
  oldReposRegex: /(?:.*(?<type>(?:git|svn|hg))(?<path>\.(?:curseforge|wowace)\.com\/.+)\/mainline(?<end>\/trunk)?)/,
  svnCheckRegex: /^(?:svn|.+):\/{2}.+\..+(?:(?:.+)?\/trunk\/)/
};
type ArrayOfArrays = string[][];
export class PkgmetaFile {
  private _directives: {
    [key:string]:string | (string | ArrayOfArrays)[][] | ArrayOfArrays | undefined;
		"package-as": string;
		"externals"?: (string | ArrayOfArrays)[][];
		"move-folders"?: ArrayOfArrays;
		"ignore"?: ArrayOfArrays;
		"required-dependencies"?: ArrayOfArrays;
		"optional-dependencies"?: ArrayOfArrays;
		"manual-changelog"?: ArrayOfArrays;
		"license-output"?: string;
		"embdded-libraries"?: ArrayOfArrays;
		"tools-used"?: ArrayOfArrays;
		"enable-nolib-creation"?: string;
	} = {
    "package-as":"Loading"
  };

  get directives() {
    return this._directives;
  }
  // { [x:string]: string | string[][] | { [x: string]:string[][] } }
  private yamlReviver(key: unknown, value: any) {
    const typedKey = <string>key;
    if(!["package-as","externals","move-folders","ignore","required-dependencies",
    "optional-dependencies","manual-changelog","license-output","embdded-libraries",
    "tools-used","enable-nolib-creation"].includes(typedKey)) {
      return value;
    }

    if(typedKey === 'package-as' || typedKey === 'enable-nolib-creation' || typedKey === 'license-output'){
      return <string>value;
    }

    if(typedKey === 'move-folders' || typedKey === 'manual-changelog'){
      const typedValue:{[key:string]:string} = value;
      let rtnValue:ArrayOfArrays = [];
      Object.keys(typedValue).map((propKey,propIndex)=>{
        const propValue = typedValue[propKey];
        rtnValue.push([propKey,propValue]);
      });
      return rtnValue;
    }

    if(typedKey === 'ignore' || typedKey === 'required-dependencies' || typedKey === 'optional-dependencies' || typedKey === 'embedded-libraries' || typedKey === 'tools-used'){
      const typedValue:string[] = value;
      let rtnValue:ArrayOfArrays = [];
      typedValue.map((arrayEntry,arrayIndex) => {
        rtnValue.push([arrayIndex.toString(),arrayEntry]);
      });
      return rtnValue;
    }

    if(typedKey === 'externals'){
      let rtnValue:(string | ArrayOfArrays)[][] = [];
      const typedValue:{[key:string]:(string|{[key:string]:string})} = value;
      Object.keys(typedValue).map((externalKey,externalIndex)=>{
        let externalEntry:{[key:string]:string} = typeof(typedValue[externalKey]) === 'object' ? Object(typedValue[externalKey]) : { url:typedValue[externalKey],type:'git'};
        const oldReposMatches = regExObj.oldReposRegex.exec(externalEntry.url)?.groups;
        if (oldReposMatches && oldReposMatches.path && oldReposMatches.type) {
          externalEntry.url = `https://repo${oldReposMatches.path}${oldReposMatches.end ? oldReposMatches.end : ''}`;
          externalEntry.type = oldReposMatches.type;
        } else {
          if (externalEntry.url.match(regExObj.svnCheckRegex)) {
            externalEntry.type = 'svn';
          } else {
            externalEntry.type = 'git';
          }
        }
        externalEntry.url = externalEntry.url + '/';
        const rtnArray = [externalKey,Object.keys(externalEntry).map(p => [p,externalEntry[p]])];
        rtnValue.push(rtnArray);
      });
      return rtnValue;
    }
  }

  pkgMetaType: string = '';
  public initialized: Promise<boolean>;

  get title(): string {
    return this._directives['package-as'];
  }

  private get treeItemEntries(): WadTreeItem[] {
    return Object.keys(this._directives).filter(v=>{
      if(v === 'package-as'){
        return false;
      } else if(v === 'enable-nolib-creation'){
        return false;
      } else {
        return true;
      }
    }).map(directiveKey => {
      const directive = this._directives[directiveKey];
      return new WadTreeItem({
        label: toProperCase(directiveKey.replace(/-/g,' ')),
        description: Array.isArray(directive) ? directive.length.toString() : directive!,
        type: 'pkgmeta',
        iconPath: !Array.isArray(directive) ? new ThemeIcon('beaker') : undefined,
        children: !Array.isArray(directive) ? [] : directive.map((externalArray)=>{
          if(directiveKey === 'externals'){
            let externalProps:ArrayOfArrays = <ArrayOfArrays>externalArray[1];
            let labelName = <string>externalArray[0];
            let description = externalProps.find(v=>v[0] === 'type')![1];
            let label = `${labelName}`;
            let tooltip = `${externalProps.find(v=>v[0] === 'url')![1]}`;
            return new WadTreeItem({
              label: label,
              tooltip: tooltip,
              description: description,
              iconPath: new ThemeIcon(description === 'git' ? 'git-branch' : 'unfold'),
              type: 'pkgmeta',
              children: []/* externalProps.map((propArray): WadTreeItem => new WadTreeItem({
                  label: propArray[0],
                  type: 'pkgmeta',
                  description: propArray[1],
                  children: []
                })) */
            });
          } else {
            let label = directiveKey === 'ignore' ? <string>externalArray[1] : <string>externalArray[0];
            if(directiveKey !== 'ignore' && directiveKey !== 'move-folders'){
              label = toProperCase(label.replace(/-/g,' '));
            }
            return new WadTreeItem({
              label: label,
              description: directiveKey === 'ignore' ? undefined : <string>externalArray[1],
              iconPath: new ThemeIcon(directiveKey === 'ignore' ? 'stop' : directiveKey === 'move-folders' ? 'arrow-right' : 'bookmark'),
              type: 'pkgmeta'
            });
          }
        })
      });
    });
  }

  get workspaceRelativePath() {
    return this.resourceUri.fsPath.replace(Workspace.getWorkspaceFolder(this.resourceUri)!.uri.fsPath, '');
  }

  get treeItem(): WadTreeItem {
    let wadItemTreeOptions: WadTreeItemOptions = {
      type: 'pkgmeta',
      label: this.title,
      children: this.treeItemEntries,
      description: Basename(this.resourceUri.fsPath),
      uri: this.resourceUri,
      tooltip: this.workspaceRelativePath
    };
    return new WadTreeItem(wadItemTreeOptions);
  }

  async tocFile(){
    let baseDir = Workspace.workspaceFolders![0].uri;

    const possiblePaths = [
      `/${this.title}.toc`,
      `${this.title}/${this.title}.toc`
    ];

    let idx = 0;
    while(idx < possiblePaths.length){
      const possiblePath = possiblePaths[idx];
      const possibleUri = Uri.joinPath(baseDir,possiblePath);
      try{
        const tocFileStat = (await Workspace.fs.stat(possibleUri));
        if(typeof(tocFileStat) !== 'undefined'){
          return possibleUri;
        }
      } catch(e){

      }
      idx++;
    }
    return false;
  }

  async libFolder(){
    let potentialFolders = ['/Library','/Libs','/Lib'];
    let idx = 0;
    let externalsFolder:string = '';
    if(this._directives["externals"]){
      const destDir = <string><unknown>this._directives.externals[0][0].toString().split('/');
      if(destDir.length > 1){
        externalsFolder = destDir[destDir.length - 2];
        potentialFolders = [externalsFolder,...potentialFolders];
      }
    }
    while(idx < potentialFolders.length){
      const potentialFolder = potentialFolders[idx];
      const testUri = Uri.joinPath(this.resourceUri,potentialFolder);
      try{
        const checkDir = (await Workspace.fs.stat(testUri));
        if(typeof(checkDir) !== 'undefined'){
          return testUri;
        }
      } catch(e){

      }
      idx++;
    }

    const configDir = Workspace.getConfiguration('wad').get('defaultLibFolder','/Libs');
    return Uri.joinPath(this.resourceUri.with({path: Dirname(this.resourceUri.fsPath)}),'/',this.title,externalsFolder.length > 0 ? externalsFolder : configDir);
  }
  smcUtils = new ScmUtils();
  private async _initialize(): Promise<boolean> {
    const pkgmetaFileString = (await Workspace.fs.readFile(this.resourceUri)).toString();
    this.pkgMetaType = this.resourceUri.toString().indexOf('.yaml') > -1 ? 'yaml' : 'dot';
    this._directives = YamlParse(pkgmetaFileString, { reviver: (key, value: any) => this.yamlReviver(key, value) });
/*     const externals = this.directives.externals;
    let res = [];
    if(externals && this.title === 'WeakAuras'){
      for (let idx = 0; idx < externals.length; idx++) {
        const external = externals[idx];
        const destDir: string = <string>external[0];
        const externalProps: ArrayOfArrays = <ArrayOfArrays>external[1];
        const repoUrl: string = externalProps.find(v => v[0] === 'url')![1];
        const repoType: string = externalProps.find(v => v[0] === 'type')![1];
        const baseDir = Workspace.workspaceFolders![0].uri;
        const libFolder = await this.libFolder();
        const results = await this.smcUtils.gitSvnClone({
          baseDir: baseDir,
          cloneDir: libFolder.with({path: Uri.joinPath(libFolder,'/.clone').path}),
          destDir: destDir,
          type: repoType,
          url: repoUrl
        });
        res.push(results);
      }
    }
    log(res); */
    return true;
  }

  constructor(
    public resourceUri: Uri,
  ) {
    this.initialized = this._initialize();
  }
}