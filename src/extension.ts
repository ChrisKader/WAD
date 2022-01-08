import {commands as Commands, ExtensionContext, extensions as Extensions, ShellExecution, window as Window, workspace as Workspace} from 'vscode';
import { WadModel } from './model';
import { CommandCenter } from './CommandCenter';
import { Scm } from './Scm';
export async function activate(context: ExtensionContext) {
  context.globalState.update('status','activate');
  if(!Workspace.workspaceFolders){
    Window.showWarningMessage('WoW Addon Dev: No workspace currently active.')
    context.globalState.update('status','noWorkspace');
  }
  const model = new WadModel(context);
  const scm = new Scm();
  const commandCenter = new CommandCenter(model, scm)
  context.subscriptions.push(
    scm,
    model,
    commandCenter
  );
  context.subscriptions.push(model);
}

// this method is called when your extension is deactivated
export function deactivate() { }
