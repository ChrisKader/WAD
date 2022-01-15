import {dirname, join as Join, } from 'path';
import * as os from 'os';
import { commands, Disposable, extensions as Extensions, OutputChannel, window as Window, Uri, Progress, ProgressLocation, CancellationToken, workspace as Workspace, FileSystemError, window } from 'vscode';
import { WadModel } from './model';
import { log } from './msutil';
import { ExternalsRoot,ExternalsChild } from './pkgmetaFile';
import { Scm } from './Scm';

interface ITemplateOptions {
  replacementText:string;
  subFolderName:string;
  filesTo:{
      replaceText?:string[]
      rename?:string[][];
      delete?:string[];
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
  async installExternals(e:ExternalsRoot):Promise<ReturnType<typeof this.installExternal>[]>{
    return e.children.map(async (c) => {
      return await this.installExternal(c);
    })
  }

  @command('wad.installExternal')
  async installExternal(e:ExternalsChild):Promise<boolean>{
    let checkoutReturn = (await (await this.scm.get(e.directiveProps.type)).clone(e.directiveProps.url,e.directiveProps.targetUri,{branch: e.directiveProps.branch,commit:e.directiveProps.commit,tag: e.directiveProps.tag}));
    // Delete the .git/.svn directory.
    await Workspace.fs.delete(Uri.joinPath(checkoutReturn.checkoutDir,`.${e.directiveProps.type}`),{recursive: true, useTrash: false}).then(void 0,(r:FileSystemError)=>{
      log(r)
    })
    await Workspace.fs.delete(checkoutReturn.options.targetUri,{recursive: true, useTrash: false}).then(void 0,(r:FileSystemError)=>{
      if(r.code !== 'FileNotFound'){
        //We can safely ignore FileNotFound as it would mean tht the target directory did not exist and that is fine.
        return r
      }
      return true
    })
    await Workspace.fs.copy(checkoutReturn.checkoutDir,checkoutReturn.options.targetUri).then(void 0,log)
    await Workspace.fs.delete(checkoutReturn.checkoutDir,{recursive: true, useTrash: false}).then(void 0,log)
    return true
  }

	@command('wad.updateFileDecoration')
	async updateFileDecoration(resoureUri: Uri) {}

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
  private async setupTemplate(){
    const defaultTemplateUrl = 'https://github.com/ChrisKader/wow-addon-template'

    const projectName = await Window.showInputBox({
      ignoreFocusOut: true,
      placeHolder: 'Example: NewWoWAddon',
      title:'Addon Name',
      prompt: 'This will be used for the folder and TOC file name. Its recommended to avoid the use of special characters and spaces.',
    })

    if(!projectName || projectName.length === 0){
      return
    }

    const initLocationArray = await Window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: Uri.file(os.homedir()),
      openLabel:"Initialize Project Directory"
    })

    if(!initLocationArray || initLocationArray.length === 0){
      return
    }

    const initLocation = initLocationArray[0]
    const projectDirUri = Uri.joinPath(initLocation,projectName)
    const cloneDirUri = await Workspace.fs.createDirectory(initLocation).then(()=>{
      const cloneDir = Uri.joinPath(initLocation,projectName)
      return Workspace.fs.createDirectory(cloneDir).then(()=>{
        return cloneDir
      },(r)=>{
        window.showErrorMessage(`Error when creating clone directory for ${projectName} in ${cloneDir.fsPath}: ${r.code} ${r.message}`)
        return false
      })
    },(r:FileSystemError)=>{
      if(r.code === 'FileExists'){
        window.showErrorMessage(`A folder with the name ${projectName} already exists in ${initLocation.fsPath}`)
      } else {
        window.showErrorMessage(`Error created ${projectName} in ${initLocation.fsPath}: ${r.code} ${r.message}`)
      }
      return false
    })
    if(!cloneDirUri){
      return;
    }

    const successfulCloneOptions = await (await this.scm.get('git')).clone(defaultTemplateUrl,cloneDirUri,{branch: 'default',noCloneDir: true})

    try {
      const templateOptions = (await Workspace.fs.readFile(Uri.joinPath(successfulCloneOptions.checkoutDir,'.templateoptions'))).toString()

      if(!templateOptions || templateOptions.length === 0){
        throw `Unable to find .templateoptions in ${successfulCloneOptions.checkoutDir.toString(true)}`
      }
      const templateOptionsObj = JSON.parse(templateOptions) as ITemplateOptions
      await Workspace.fs.rename(Uri.joinPath(successfulCloneOptions.checkoutDir,templateOptionsObj.subFolderName),Uri.joinPath(successfulCloneOptions.checkoutDir,projectName)).then(void 0,(r)=>{
        log('ERROR',r)
        throw `Unable to rename ${templateOptionsObj.subFolderName} in ${successfulCloneOptions.checkoutDir.toString(true)}`
      });
      const replaceRegExStr = `${templateOptionsObj.replacementText}`

      if(templateOptionsObj.filesTo.replaceText){
        for await (const f of templateOptionsObj.filesTo.replaceText) {
          const repRegEx = new RegExp(replaceRegExStr,'gm')
          const filename = f.replace(repRegEx,projectName);
          const UriToRead = Uri.joinPath(successfulCloneOptions.checkoutDir,filename);
          log(`Reading ${UriToRead.toString(true)}....`)
          const textToWrite = (await Workspace.fs.readFile(UriToRead)).toString().replace(repRegEx, projectName)
          await Workspace.fs.writeFile(UriToRead,Buffer.from(textToWrite)).then(()=>{
            log(`${UriToRead.toString(true)} write success`)
          },(r)=>{
            log(`${UriToRead.toString(true)} write failed`,r)
            throw `${UriToRead.toString(true)} write failed ${r}`
          })
        }
      }

      if(templateOptionsObj.filesTo.rename){
        for await (const fileInfo of templateOptionsObj.filesTo.rename) {
          const repRegEx = new RegExp(replaceRegExStr,'gm')
          const oldFilenameUri = Uri.joinPath(cloneDirUri,fileInfo[0].replace(repRegEx,projectName))
          const newFilenameUri = Uri.joinPath(cloneDirUri,fileInfo[1].replace(repRegEx,projectName))
          await Workspace.fs.rename(oldFilenameUri,newFilenameUri,{overwrite: true}).then(()=>{
            log(`Rename From ${oldFilenameUri.toString(true)} to ${newFilenameUri.toString(true)} successful`)
          },(r:FileSystemError)=>{
            if(r.message !== 'FileNotFound'){
              throw `Error renaming ${oldFilenameUri.toString(true)} to ${newFilenameUri.toString(true)}`
            }
          });
        }
      }

      if(templateOptionsObj.filesTo.delete){
        for await (const fileInfo of templateOptionsObj.filesTo.delete) {
          const uriToDelete = Uri.joinPath(cloneDirUri,fileInfo)
          await Workspace.fs.delete(Uri.joinPath(cloneDirUri,fileInfo),{recursive: true,useTrash: false}).then(void 0,(r:FileSystemError)=>{
            if(r.message !== 'FileNotFound'){
              throw `Error deleting ${uriToDelete.toString(true)}`
            }
          });
        }
      }

      const scmFolderUri = Uri.joinPath(cloneDirUri,`.${successfulCloneOptions.options.scmInfo.scm}`)
      await Workspace.fs.delete(scmFolderUri,{recursive: true,useTrash: false}).then(void 0,(r:FileSystemError)=>{
        if(r.message !== 'FileNotFound'){
          throw `Error deleting SCM folder at ${scmFolderUri}`
        }
      });
      (await this.scm.get('git')).init(cloneDirUri)
      commands.executeCommand('vscode.openFolder', cloneDirUri, { forceNewWindow: true })
    } catch (err: any) {
      Window.showErrorMessage(err)
      await Workspace.fs.delete(successfulCloneOptions.checkoutDir,{useTrash: false, recursive: true})
      return;
    }
  }

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}
}