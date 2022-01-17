import { CancellationToken, commands as Commands, DecorationOptions, DocumentSelector, ExtensionContext, extensions as Extensions, Hover, languages as Languages, MarkdownString, OverviewRulerLane, Position, Range, ShellExecution, TextDocument, window as Window, workspace as Workspace } from 'vscode';
import { WadModel } from './model';
import { WadNotifcationProvider } from './notificationProvider';
import { CommandCenter } from './CommandCenter';
import { Scm } from './Scm';
import { registerHoverProvider } from './hoverProvider';

export async function activate(context: ExtensionContext) {

  const notificationProvider = new WadNotifcationProvider()

  context.globalState.update('status', 'activate');
  if (!Workspace.workspaceFolders) {
    context.globalState.update('status', 'noWorkspace');
  }

  registerHoverProvider(context);
  const scm = new Scm();
  await scm.get('svn').then((svn) => {
    scm.get('git').then(git => {
      const model = new WadModel(context, { scm: scm, git, svn }, notificationProvider)
      const commandCenter = new CommandCenter(model, scm)
      context.subscriptions.push(
        scm,
        model,
        commandCenter
      );
      context.subscriptions.push(model);

    }, (gitReject) => {
      return gitReject
    }).catch(r => {
      Window.showErrorMessage(`Did not find good Git install. ${r}`)
    })
  }, (svnReject) => {
    return svnReject
  }).catch(r => {
    Window.showErrorMessage(`Did not find good SVN install. ${r}`)
  })
}

// this method is called when your extension is deactivated
export function deactivate() { }
