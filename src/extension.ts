import {commands as Commands, ExtensionContext, extensions as Extensions, ShellExecution, window as Window, workspace as Workspace} from 'vscode';
import { WadModel } from './model';

export function activate(context: ExtensionContext) {
  context.globalState.update('init','activate');
  const model = new WadModel(context);
  context.subscriptions.push(model);
}

// this method is called when your extension is deactivated
export function deactivate() { }
