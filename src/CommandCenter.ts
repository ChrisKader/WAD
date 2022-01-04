import * as path from 'path';
import { commands, Disposable, extensions as Extensions, OutputChannel, window, Uri, Progress, ProgressLocation, CancellationToken } from 'vscode';
import { WadModel } from './model';

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
	) {
		this.disposables = watCommands.map(({ commandId, key, method, options }) => {
			const command = this.createCommand(commandId, key, method, options);

			return commands.registerCommand(commandId, command);
		});
	}

  @command('wad.installExternal')
  async installExternal(){

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