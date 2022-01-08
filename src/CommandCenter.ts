import {join as Join, } from 'path';
import { commands, Disposable, extensions as Extensions, OutputChannel, window, Uri, Progress, ProgressLocation, CancellationToken, workspace as Workspace, FileSystemError } from 'vscode';
import { WadModel } from './model';
import { log } from './msutil';
import { ExternalsRoot,ExternalsChild } from './pkgmetaFile';
import { Scm } from './Scm';

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
    let checkoutReturn = (await (await this.scm.get(e.directiveProps.type)).checkout(e.directiveProps.url,e.directiveProps.targetUri));
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

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}
}