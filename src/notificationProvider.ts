import { OutputChannel, Uri, window as Window, workspace } from 'vscode';
import { logTimestamp } from './msutil';

export class WadNotifcationProvider {
  private readonly _outputChannel: OutputChannel;

  dispose() {
    this._outputChannel;
  }

  async errorDialog(message: string, details?: string, uri?:Uri){
    const messageOptions = details ? {
      modal: true,
      details: details
    } : {};
    const choices = uri ? [
      'Open File',
      'Cancel'
    ] : [];
    const result = await Window.showErrorMessage(message,messageOptions,...choices);
    if(uri && result === 'Open File'){
      workspace.openTextDocument(uri);
    }
  }

  public outputChannel(text: string, fromFile: string, type?: number) {
    const linePrefix = `${logTimestamp()}`;
    this._outputChannel.appendLine(`${linePrefix}: ${fromFile}: ${text}`);
  }

  constructor(){
    this._outputChannel = Window.createOutputChannel('WoW Addon Dev');
  }
}