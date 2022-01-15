import { basename, dirname, join as Join, } from 'path';
import * as os from 'os';
import { commands, Disposable, extensions as Extensions, OutputChannel, window as Window, Uri, Progress, ProgressLocation, CancellationToken, workspace as Workspace, FileSystemError, window, QuickPickItem } from 'vscode';
import { WadModel } from './model';
import { log } from './msutil';
import { ExternalsRoot, ExternalsChild, ExtDirChildOpt } from './pkgmetaFile';
import { Scm } from './Scm';

interface ITemplateOptions {
  replacementText: string;
  subFolderName: string;
  filesTo: {
    replaceText?: string[]
    rename?: string[][];
    delete?: string[];
  }
}

interface WadCommandOptions {
  uri?: boolean;
}

interface WatCommand {
  commandId: string;
  key: string;
  method: Function;
  options: WadCommandOptions;
}

const watCommands: WatCommand[] = [];

function command(commandId: string, options: WadCommandOptions = {}): Function {
  return (_target: any, key: string, descriptor: any) => {
    if (!(typeof descriptor.value === 'function')) {
      throw new Error('not supported');
    }
    watCommands.push({ commandId, key, method: descriptor.value, options });
  };
}

export class CommandCenter {
  private disposables: Disposable[];

  constructor(
    private model: WadModel,
    private scm: Scm
  ) {
    this.disposables = watCommands.map(({ commandId, key, method, options }) => {
      const command = this.createCommand(commandId, key, method, options);

      return commands.registerCommand(commandId, command);
    });
  }

  @command('wad.installExternals')
  async installExternals(e: ExternalsRoot): Promise<ReturnType<typeof this.installExternal>[]> {
    return e.children.map(async (c) => {
      return await this.installExternal(c);
    })
  }

  @command('wad.installExternal')
  async installExternal(e: ExternalsChild): Promise<{ external: ExtDirChildOpt, success: boolean }> {
    const returnObj = {
      external: e.directiveProps,
      success: false
    }
    return new Promise(async (res, rej) => {
      let checkoutReturn = await this.model.neededScms[e.directiveProps.type].clone(e.directiveProps.url, e.directiveProps.targetUri, { branch: e.directiveProps.branch, commit: e.directiveProps.commit, tag: e.directiveProps.tag }).catch((r) => {
        rej(returnObj);
        log(`Unsuccessful checkout of library ${e.directiveProps.url} ${r}`)
      })
      if (!checkoutReturn || !checkoutReturn.checkoutDir) {
        log(`Unsuccessful checkout of library ${e.directiveProps.url}`);
        rej(returnObj)
      }
      // Delete the .git/.svn directory.
      await Workspace.fs.delete(Uri.joinPath(checkoutReturn!.checkoutDir, `.${e.directiveProps.type}`), { recursive: true, useTrash: false }).then(void 0, (r: FileSystemError) => {
        log(r)
      })
      await Workspace.fs.delete(checkoutReturn!.options.targetUri, { recursive: true, useTrash: false }).then(void 0, (r: FileSystemError) => {
        if (r.code !== 'FileNotFound') {
          //We can safely ignore FileNotFound as it would mean tht the target directory did not exist and that is fine.
          return r
        }
      })
      await Workspace.fs.copy(checkoutReturn!.checkoutDir, checkoutReturn!.options.targetUri).then(void 0, log)
      await Workspace.fs.delete(checkoutReturn!.checkoutDir, { recursive: true, useTrash: false }).then(void 0, log)
      returnObj.success = true
      res(returnObj);
    })
  }

  @command('wad.updateFileDecoration')
  async updateFileDecoration(resoureUri: Uri) { }

  private createCommand(id: string, key: string, method: Function, options: WadCommandOptions): (...args: any[]) => any {
    const result = (...args: any[]) => {
      let result: Promise<any>;
      result = Promise.resolve(method.apply(this, args));
    };
    // patch this object, so people can call methods directly
    (this as any)[key] = result;
    return result;
  }

  @command('wad.setuptempate')
  private async setupTemplate() {

    const defaultTemplateUrl = 'https://github.com/ChrisKader/wow-addon-template/'

    // Begin information gathering.

    // Determine the location of the addons base folder.
    // TODO: Save fist time selected value to config for later use.

    const extConfig = Workspace.getConfiguration('wad')
    const defaultParentDir = Uri.file(extConfig.get('defaultParentDir', os.homedir()))

    const addonParentDir = await Window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: defaultParentDir,
      openLabel: "Initialize Project Directory"
    }).then(v => v ? v[0] : undefined)

    if (!addonParentDir) {
      return
    }

    extConfig.update('defaultParentDir', addonParentDir.fsPath, true);

    const addonName = await Window.showInputBox({
      ignoreFocusOut: true,
      placeHolder: 'Example: NewWoWAddon',
      title: 'Addon Name',
      prompt: 'This will be used for the folder and TOC file name. Its recommended to avoid the use of special characters and spaces.',
    });


    if (!addonName || addonName.length === 0) {
      // No addon name provided or cancelled.
      Window.showErrorMessage(`Addon name not provided or invalid.`);
      return;
    }

    let addonBaseDir = Uri.joinPath(addonParentDir, addonName)
    const addonFolderExists = typeof (await Workspace.fs.stat(addonBaseDir).then(v => v.type, () => undefined)) !== 'undefined'

    // Check if folder already exists.
    if (addonFolderExists) {
      Window.showErrorMessage(`Folder with the name ${addonName} already exists in ${addonParentDir.toString(true)}.`);
      return;
    }

    const defaultSteps:{
      [key: string]:QuickPickItem & {step:string,type:string,info?:string}
    } = {
      pickExternals: {
        label: 'Externals',
        description: `Select additional libraries to install and include in .pkgmeta file.`,
        step: 'pickExternals',
        type: 'pick',
        picked: true,
      },
      initFolder:{
        label: `Git init ${addonName}`,
        description: `Initialize the folder created for ${addonName} with git (Source Code Management)`,
        step: 'initFolder',
        type: 'pick',
        picked: true,
      },
      includeLuacheck:{
        label: '.luacheckrc',
        info:'\/.luacheckrc',
        description: 'Include a baseline file for use with LuaCheck',
        step: 'includeLuacheck',
        type: 'deleteFile',
        picked: true,
      },
      includePkgMeta:{
        label: '.pkgmeta',
        info:'\/.pkgmeta',
        description: `Include a .pkgmeta file used with the BigWigsMods/packager (customized for ${addonName})`,
        step: 'includePkgMeta',
        type: 'deleteFile',
        picked: true,
      },
      includeGitHubFolder:{
        label: '.github',
        info:'\/.github',
        description: `Include a .github directory that contains a workflow that can be used with GitHub actions (customized for ${addonName})`,
        step: 'includeGitHubFolder',
        type: 'deleteFile',
        picked: true,
      },
      includeGitIgnore:{
        label: '.gitignore',
        info:'\/.gitignore',
        description: `Include a .gitignore file (customized for ${addonName})`,
        step: 'includeGitIgnore',
        type: 'deleteFile',
        picked: true,
      },
      includeChangelog:{
        label: 'CHANGELOG.md',
        info:'CHANGELOG.md',
        description: `Include blank CHANGELOG.md file.`,
        step: 'includeChangelog',
        type: 'deleteFile',
        picked: true,
      },
      includeReadme:{
        label: 'README.md',
        info:'README.md',
        description: `Include blank README.md file (customized for ${addonName})`,
        step: 'includeReadme',
        type: 'deleteFile',
        picked: true,
      },
    }

    const libraryList = await this.model.getLibraryList()
    const stepsToComplete = await Window.showQuickPick(Object.keys(defaultSteps).map(v=>defaultSteps[v]), { canPickMany: true })
    let librariesToInstall: { label: string; description: string; index: number; }[] | undefined = []

    // default library folder is Libs
    let libraryFolderName: string = 'Libs'

    if (stepsToComplete && stepsToComplete.length > 0 && stepsToComplete.includes(defaultSteps.pickExternals)) {
      // get the predefined library list.

      // if the predefined list has entries then show a quick pick.
      // TODO: Allow for adding libraries not in the list.
      if (libraryList.length > 0) {
        librariesToInstall = await Window.showQuickPick(libraryList.map((v, i) => {
          return {
            label: v.name,
            description: `${v.tag ? '$(tag) ' + v.tag : v.version} ${v.url}`,
            index: i
          }
        }), { canPickMany: true })
      }

      // If the user selected any libraries to install, ask for the library folder name they would like. Default to Libs if nothing provided.
      if (librariesToInstall && librariesToInstall.length > 0) {
        const pickedLibraryFolderName = await Window.showInputBox({
          value: libraryFolderName,
          ignoreFocusOut: true,
          placeHolder: 'Default: Libs',
          title: 'Library Folder Name',
          prompt: 'This folder will be used as the parent directory for any libraries previously selected.',
        });

        if (!libraryFolderName) {
          Window.showErrorMessage(`Library folder name not provided or invalid.`);
          return;
        }

        libraryFolderName = pickedLibraryFolderName || libraryFolderName;
      }
    }

    const progressWindow = Window.withProgress({
      location: ProgressLocation.Notification,
      title: `Creating ${addonName}`,
      cancellable: true,
    }, (progress, cancelToken) => {
      return new Promise(async (res, rej) => {
        const totalBaseSteps = 10

        let totalSteps = totalBaseSteps + (librariesToInstall?.length || 0)

        let progInfo = this.updateProgress({
          progress,
          currentProgress: 0,
          currentStep: 0,
          totalSteps: totalSteps,
        }, `Creating ${addonName} folder.`)

        // check for our addonBaseDir agian, just in case.
        await Workspace.fs.stat(addonBaseDir).then(v => {
          if (v) {
            rej(`Project Directory already exists at ${addonBaseDir.toString(true)}`)
          }
        }, (r) => {
          log(`${addonBaseDir.toString(true)} does not exist. Continuing`)
        })

        // Step 1: Create Addon Base Directory
        addonBaseDir = await Workspace.fs.createDirectory(addonBaseDir).then(() => {
          return addonBaseDir
        }, (r: FileSystemError) => {
          if (r.code === 'FileExists') {
            rej(`A folder with the name ${addonName} already exists in ${addonParentDir.toString(true)}`)
          } else {
            rej(`Error created ${addonName} in ${addonParentDir.toString(true)}: ${r.code} ${r.message}`)
          }
        })

        if (!addonBaseDir) {
          rej(`Unable to determine clone directory.`)
        }

        progInfo = this.updateProgress(progInfo, `Cloning addon template from Github.`)
        //Step 2: Clone template into addon base directory.
        const templateCloneResults = await this.model.neededScms.git.clone(defaultTemplateUrl, addonBaseDir, { branch: 'default', noProgress: true, noCloneDir: true })
        if (!templateCloneResults.checkoutDir) {
          rej(`Unsuccessful template checkout ${templateCloneResults}`)
        }

        progInfo = this.updateProgress(progInfo, `Parsing .templateoptions file`)
        const tempOptsUri = Uri.joinPath(templateCloneResults.checkoutDir, '.templateoptions')
        const templateOptionsStr = (await Workspace.fs.readFile(tempOptsUri)).toString()

        //Step 3: Check for and parse .templateoptions file.
        // Ensure .templateoptions is preset.
        if (!templateOptionsStr || templateOptionsStr.length === 0) {
          rej(`Unable to find .templateoptions in ${templateCloneResults.checkoutDir.toString(true)}`)
        }

        // Parse .templateoptions file into an object then delete the file.
        const templateOptions = JSON.parse(templateOptionsStr) as ITemplateOptions

        await Workspace.fs.delete(tempOptsUri, { recursive: false, useTrash: true }).then(() => { }, (r) => { })
        progInfo = this.updateProgress(progInfo, `Rename the default subfolder.`)
        // Step 4: Rename the default subfolder.
        // Rename template sub-folder to the project name using templateOptions to get the default folder name.
        await Workspace.fs.rename(Uri.joinPath(templateCloneResults.checkoutDir, templateOptions.subFolderName), Uri.joinPath(templateCloneResults.checkoutDir, addonName)).then(void 0, (r) => {
          log('ERROR', r)
          rej(`Unable to rename ${templateOptions.subFolderName} in ${templateCloneResults.checkoutDir.toString(true)}`)
        })

        const replaceRegExStr = `${templateOptions.replacementText}`

        progInfo = this.updateProgress(progInfo, `Replacing template text.`)
        //Step 5: Replace any text.
        if (templateOptions.filesTo.replaceText) {
          for await (const f of templateOptions.filesTo.replaceText) {
            const repRegEx = new RegExp(replaceRegExStr, 'gm')
            const filename = f.replace(repRegEx, addonName);
            const UriToRead = Uri.joinPath(templateCloneResults.checkoutDir, filename);
            progInfo = this.updateProgress(progInfo, `Replacing template text in ${filename}`, true)
            log(`Reading ${UriToRead.toString(true)}....`)
            const textToWrite = (await Workspace.fs.readFile(UriToRead)).toString().replace(repRegEx, addonName)
            await Workspace.fs.writeFile(UriToRead, Buffer.from(textToWrite)).then(() => {
              log(`${UriToRead.toString(true)} write success`)
            }, (r) => {
              log(`${UriToRead.toString(true)} write failed`, r)
              rej(`${UriToRead.toString(true)} write failed ${r}`)
            })
          }
        }

        progInfo = this.updateProgress(progInfo, `Renaming files`)
        //Step 6: Rename files.
        if (templateOptions.filesTo.rename) {
          for await (const fileInfo of templateOptions.filesTo.rename) {
            const repRegEx = new RegExp(replaceRegExStr, 'gm')
            const oldFilenameUri = Uri.joinPath(addonBaseDir, fileInfo[0].replace(repRegEx, addonName))
            const newFilenameUri = Uri.joinPath(addonBaseDir, fileInfo[1].replace(repRegEx, addonName))
            progInfo = this.updateProgress(progInfo, `${basename(oldFilenameUri.fsPath)} to ${basename(newFilenameUri.fsPath)}`, true)
            await Workspace.fs.rename(oldFilenameUri, newFilenameUri, { overwrite: true }).then(() => {
              log(`Rename From ${oldFilenameUri.toString(true)} to ${newFilenameUri.toString(true)} successful`)
            }, (r: FileSystemError) => {
              if (r.message !== 'FileNotFound') {
                rej(`Error renaming ${oldFilenameUri.toString(true)} to ${newFilenameUri.toString(true)}`)
              }
            });
          }
        }

        progInfo = this.updateProgress(progInfo, `Deleting files`)
        //Step 7: Delete files.
        if (templateOptions.filesTo.delete) {
          for await (const fileInfo of templateOptions.filesTo.delete) {
            const uriToDelete = Uri.joinPath(addonBaseDir, fileInfo)
            progInfo = this.updateProgress(progInfo, `Deleting ${fileInfo}`, true)
            await Workspace.fs.delete(Uri.joinPath(addonBaseDir, fileInfo), { recursive: true, useTrash: false }).then(void 0, (r: FileSystemError) => {
              if (r.message !== 'FileNotFound') {
                rej(`Error deleting ${uriToDelete.toString(true)}`)
              }
            });
          }
        }

        progInfo = this.updateProgress(progInfo, `Deleting source control folder.`)
        //Step 8: Delete the source control folder.
        const scmFolderUri = Uri.joinPath(addonBaseDir, `.${templateCloneResults.options.scmInfo.scm}`)
        await Workspace.fs.delete(scmFolderUri, { recursive: true, useTrash: false }).then(void 0, (r: FileSystemError) => {
          if (r.message !== 'FileNotFound') {
            rej(`Error deleting SCM folder at ${scmFolderUri}`)
          }
        });

        progInfo = this.updateProgress(progInfo, `Installing Externals`)
        //Step: 9: Install any libraries.
        if (librariesToInstall && librariesToInstall.length > 0) {
          // Build base library folder Uri based on selections made.
          const libFolderBaseUri = Uri.joinPath(addonBaseDir, addonName, libraryFolderName)
          const libFolderPath = addonName + "/" + libraryFolderName
          const externalsInfo: string[] = ['externals:']
          // Delete the folder if it exists (though it shouldnt.)
          await Workspace.fs.delete(libFolderBaseUri).then(void 0, (r) => { });
          let currIdx = 1
          // Loop through libraries selected.
          for await (const libraryToInstall of librariesToInstall) {
            progInfo = this.updateProgress(progInfo, `Installing External: ${libraryToInstall.label} (${currIdx}/${librariesToInstall.length})`)
            // get info for selected library.
            const currentLibraryInfo = libraryList[libraryToInstall.index];
            // build uri for current library.
            const currentLibraryUri = Uri.joinPath(libFolderBaseUri, currentLibraryInfo.folder)
            const currentLibFolderPath = libFolderPath + "/" + currentLibraryInfo.folder
            // delete the folder if it exists.
            await Workspace.fs.delete(currentLibraryUri).then(void 0, (r) => { });
            // create directory for current library
            const libCloneDirUri = await Workspace.fs.createDirectory(currentLibraryUri).then(() => {
              return currentLibraryUri
            }, (r: FileSystemError) => {
              rej(`Error when creating library folder ${currentLibraryInfo.folder} in ${currentLibraryUri.toString(true)}: ${r.code} ${r.message}`)
            })

            const currentLibraryCloneResults = await this.model.neededScms[currentLibraryInfo.scm].clone(currentLibraryInfo.url, libCloneDirUri, { noProgress: true, noCloneDir: true }).catch((r) => {
              rej(`Unsuccessful checkout of library ${currentLibraryInfo} ${currentLibraryCloneResults}`);
            })

            if (!currentLibraryCloneResults || !currentLibraryCloneResults.checkoutDir) {
              rej(`Unsuccessful checkout of library ${currentLibraryInfo} ${currentLibraryCloneResults}`);
            }
            externalsInfo.push(`  ${currentLibFolderPath}: ${currentLibraryInfo.url}`)
            currIdx++
          }
          const pkgMetaPath = Uri.joinPath(addonBaseDir, '\/.pkgmeta')
          const currentPkgMetaString = (await Workspace.fs.readFile(pkgMetaPath)).toString()
          const newPkgMetaString = currentPkgMetaString + externalsInfo.join('\n')
          await Workspace.fs.writeFile(pkgMetaPath, Buffer.from(newPkgMetaString))
        }

        for await (const step of Object.keys(defaultSteps).filter(f=>stepsToComplete?.findIndex(v=>v.step === f) === -1).filter(f=>defaultSteps[f].type === 'deleteFile').map(f => defaultSteps[f])) {
          const deleteFileUri = Uri.joinPath(addonBaseDir,step.info!);
          await Workspace.fs.delete(deleteFileUri).then(r=>{},r=>{})
        }

        //Step 10: Init addon folder.
        progInfo = this.updateProgress(progInfo, `Git Initializing ${addonName}`);
        if(stepsToComplete?.includes(defaultSteps.initFolder)){
          this.model.neededScms.git.init(addonBaseDir)
        }
        commands.executeCommand('vscode.openFolder', addonBaseDir, { forceNewWindow: true })
        res(addonBaseDir)
      }).catch(async (r) => {
        Window.showErrorMessage(r)
        await Workspace.fs.delete(addonBaseDir, { useTrash: false, recursive: true })
        return;
      })
    })
  }

  updateProgress = (opt: { progress: Progress<{ increment: number; message?: string }>, currentProgress: number, currentStep: number, totalSteps: number }, message: string, noProg?: boolean) => {
    const stepValue = 100 / opt.totalSteps
    opt.currentStep = opt.currentStep + (noProg ? 0 : 1)
    const newProgress = Math.floor(opt.currentStep * stepValue) <= 100 ? Math.floor(opt.currentStep * stepValue) : 100;
    opt.progress.report({ increment: newProgress - opt.currentProgress, message: `${message} ${newProgress}%` });
    opt.currentProgress = newProgress;
    return opt;
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }
}